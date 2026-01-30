/* Puntos Dieta – sin servidor. Todo localStorage.
   - Toca una categoría para sumar/restar puntos consumidos.
   - Cambia el modo (Puntos/Usados/Equivalentes) con las pestañas.
   - Cambia de día con Ayer/Mañana o tocando "Hoy" (date picker).
*/
(() => {
  const $ = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

  const STORE_KEY = "puntos_dieta_v1";

  // ---- Firebase configuration and initialization ----
  // Provide your Firebase project configuration below. Replace the placeholder
  // strings with the values from your Firebase console (firebaseConfig). See
  // https://firebase.google.com/docs/web/setup#initialize-with-config
  const firebaseConfig = {
    apiKey: "AIzaSyBvVA6PoRyDaJKl_C_YDep53QuFzLjH_n8",
    authDomain: "puntos-app-4caaf.firebaseapp.com",
    projectId: "puntos-app-4caaf",
    storageBucket: "puntos-app-4caaf.firebasestorage.app",
    messagingSenderId: "902581122850",
    appId: "1:902581122850:web:15c290df944079dcce977b",
    measurementId: "G-9V5M42M93V"
  };

  // Inicializar Firebase solo si está disponible y aún no se ha inicializado.
  if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length === 0) {
    firebase.initializeApp(firebaseConfig);
    // Habilita la persistencia offline para Firestore. Esto hará que los
    // cambios se sincronicen automáticamente cuando haya conexión.
    firebase.firestore().enablePersistence().catch(() => {});
  }
  // Referencias a los servicios de Firebase
  const auth = (typeof firebase !== 'undefined') ? firebase.auth() : null;
  const db   = (typeof firebase !== 'undefined') ? firebase.firestore() : null;

  const DEFAULT_CATEGORIES = [
    { key:"cereales",   name:"Cereales",    color:"#b77a28", icon:"🌾", goal:5 },
    { key:"proteinas",  name:"Proteínas",   color:"#e85b5b", icon:"🥩", goal:7 },
    { key:"grasas",     name:"Grasas",      color:"#f2c94c", icon:"🧈", goal:4 },
    { key:"frutas",     name:"Frutas",      color:"#ff4fa6", icon:"🍌", goal:3 },
    { key:"verduras",   name:"Verduras",    color:"#cfcfcf", icon:"🥦", goal:0 },
    { key:"lacteos",    name:"Lácteos",     color:"#55b6ff", icon:"🥛", goal:1 },
    { key:"azucares",   name:"Azúcares",    color:"#cfcfcf", icon:"🍬", goal:0 },
    { key:"leguminosas",name:"Leguminosas", color:"#6b5bff", icon:"🫘", goal:1 },
    { key:"agua",       name:"Agua",        color:"#3fd5ff", icon:"💧", goal:2 },
  ];

  const todayISO = () => {
    const d = new Date();
    // local date in ISO yyyy-mm-dd
    const tzOff = d.getTimezoneOffset();
    const local = new Date(d.getTime() - tzOff*60000);
    return local.toISOString().slice(0,10);
  };

  const addDaysISO = (iso, delta) => {
    const d = new Date(iso + "T12:00:00");
    d.setDate(d.getDate() + delta);
    return d.toISOString().slice(0,10);
  };

  const formatDayTitle = (iso) => {
    const d = new Date(iso + "T12:00:00");
    const opts = { weekday:"long", day:"numeric", month:"long" };
    return d.toLocaleDateString("es-MX", opts);
  };

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  function loadState(){
    try{
      const raw = localStorage.getItem(STORE_KEY);
      if(!raw) return null;
      return JSON.parse(raw);
    }catch(e){
      return null;
    }
  }

  function saveState(state){
    // Si hay usuario autenticado, guarda en Firestore.
    // Si no hay usuario, usa localStorage para una experiencia local.
    if (auth && auth.currentUser && db) {
      db.collection('users').doc(auth.currentUser.uid).set(state).catch(()=>{});
      return;
    }
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  }

  function initState(){
    const base = {
      version: 1,
      settings: {
        totalGoal: DEFAULT_CATEGORIES.reduce((a,c)=>a+c.goal, 0),
        mode: "remaining",
      },
      categories: DEFAULT_CATEGORIES.map(c => ({...c})),
      days: {
        // iso: { used: {key:number}, history:[{key,delta,ts}] }
      }
    };
    saveState(base);
    return base;
  }

  function getDay(state, iso){
    if(!state.days[iso]){
      state.days[iso] = { used:{}, history:[], weight: null };
      for(const c of state.categories) state.days[iso].used[c.key] = 0;
      saveState(state);
    }
    if(state.days[iso].weight === undefined){
      state.days[iso].weight = null;
    }
    return state.days[iso];
  }

  function round1(x){
    // Keep one decimal, avoid -0.0
    const v = Math.round((x + Number.EPSILON) * 10) / 10;
    return Math.abs(v) < 0.0001 ? 0 : v;
  }

  // Elements
  const grid = $("#grid");
  const remainingTotalEl = $("#remainingTotal");
  const bigGaugeEl = $("#bigGauge");
  const bigLabelEl = $("#bigLabel");
  const dayTitleBtn = $("#dayTitle");
  const datePicker = $("#datePicker");

  // Drawer
  const drawer = $("#drawer");
  const menuBtn = $("#menuBtn");
  const drawerScrim = $("#drawerScrim");
  const drawerCloseBtn = $("#drawerCloseBtn");
  const resetDayBtn = $("#resetDayBtn");
  const exportBtn = $("#exportBtn");
  const aboutBtn = $("#aboutBtn");

  // Date nav
  const prevDayBtn = $("#prevDayBtn");
  const nextDayBtn = $("#nextDayBtn");

  // Tabs
  const tabs = $$(".tab");

  // Category modal
  const catModal = $("#catModal");
  const modalTitle = $("#modalTitle");
  const modalGoal = $("#modalGoal");
  const modalUsed = $("#modalUsed");
  const modalRem  = $("#modalRem");
  const modalCloseBtn = $("#modalCloseBtn");
  const customInput = $("#customInput");
  const addCustomBtn = $("#addCustomBtn");
  const subCustomBtn = $("#subCustomBtn");
  const undoBtn = $("#undoBtn");
  const goalInput = $("#goalInput");
  const saveGoalBtn = $("#saveGoalBtn");

  // Goal modal
  const goalModal = $("#goalModal");
  const goalCloseBtn = $("#goalCloseBtn");
  const totalGoalInput = $("#totalGoalInput");
  const saveTotalGoalBtn = $("#saveTotalGoalBtn");
  const autoFromCatsBtn = $("#autoFromCatsBtn");
  const weightInput = $("#weightInput");
  const saveWeightBtn = $("#saveWeightBtn");
  const weightValue = $("#weightValue");
  const weightChart = $("#weightChart");
  const weightChartEmpty = $("#weightChartEmpty");

  // Export modal
  const exportModal = $("#exportModal");
  const exportCloseBtn = $("#exportCloseBtn");
  const exportArea = $("#exportArea");
  const copyExportBtn = $("#copyExportBtn");
  const importBtn = $("#importBtn");

  // Login screen elements for Firebase Auth
  // These correspond to the login overlay defined in index.html. When a user
  // is not authenticated the overlay will be shown to prompt for email
  // and contraseña. When a user is authenticated, the overlay is hidden.
  const loginScreen = $("#loginScreen");
  const loginEmailInput = $("#loginEmail");
  const loginPasswordInput = $("#loginPassword");
  const loginBtn = $("#loginBtn");
  const signupBtn = $("#signupBtn");

  // Helper to show or hide the login overlay. When "visible" is true the
  // overlay is shown (aria-hidden="false"); otherwise it is hidden. This
  // function safely no-ops if the loginScreen element does not exist.
  function toggleLoginScreen(visible) {
    if (!loginScreen) return;
    loginScreen.setAttribute("aria-hidden", visible ? "false" : "true");
  }

  // App vars
  let state = (auth ? initState() : (loadState() ?? initState()));
  let currentISO = todayISO();
  let currentCatKey = null;

  function setDrawer(open){
    drawer.setAttribute("aria-hidden", open ? "false":"true");
  }

  function openModal(modal){
    modal.setAttribute("aria-hidden","false");
    // prevent body scroll bounce on iOS
    document.body.style.overflow = "hidden";
  }
  function closeModal(modal){
    modal.setAttribute("aria-hidden","true");
    document.body.style.overflow = "";
  }

  function setMode(mode){
    if(!["remaining", "used"].includes(mode)) return;
    state.settings.mode = mode;
    saveState(state);
    tabs.forEach(t => {
      const active = t.dataset.mode === mode;
      t.classList.toggle("active", active);
      t.setAttribute("aria-selected", active ? "true":"false");
    });
    render();
  }

  function getTotals(day){
    const usedTotal = state.categories.reduce((sum,c)=> sum + (day.used[c.key] ?? 0), 0);
    const remaining = state.settings.totalGoal - usedTotal;
    return { usedTotal: round1(usedTotal), remaining: round1(remaining) };
  }

  function setBigGauge(remaining, totalGoal){
    const frac = totalGoal <= 0 ? 0 : clamp(remaining / totalGoal, 0, 1);
    // Gauge is 270deg sweep (0.75 turn). Start at 225deg.
    const sweepTurns = 0.75 * frac;
    bigGaugeEl.style.background = `conic-gradient(from 225deg,
      rgba(120,80,40,0.80) 0turn,
      rgba(120,80,40,0.80) ${sweepTurns}turn,
      rgba(0,0,0,0.07) ${sweepTurns}turn 0.75turn,
      rgba(0,0,0,0.00) 0.75turn 1turn)`;
  }

  function makeCard(c, day){
    const used = day.used[c.key] ?? 0;
    const rem = round1(c.goal - used);
    const mode = state.settings.mode;

    let pillText = "0";
    let sub = "";
    if(mode === "remaining"){
      pillText = rem.toFixed(1);
      sub = "Restantes";
    }else if(mode === "used"){
      pillText = round1(used).toFixed(1);
      sub = "Usados";
    }

    const frac = c.goal <= 0 ? 0 : clamp((mode==="remaining" ? rem : used) / c.goal, 0, 1);
    const sweep = 0.75 * frac;

    const el = document.createElement("button");
    el.className = "card";
    el.type = "button";
    el.dataset.key = c.key;
    el.innerHTML = `
      <div class="gauge" style="background: conic-gradient(from 225deg,
        ${c.color} 0turn,
        ${c.color} ${sweep}turn,
        rgba(0,0,0,0.08) ${sweep}turn 0.75turn,
        rgba(0,0,0,0.00) 0.75turn 1turn);">
        <div class="gauge-inner">
          <div class="pill" style="background:${c.color}">${pillText}</div>
          <div class="emoji" aria-hidden="true" style="font-size:20px;margin-top:2px">${c.icon}</div>
        </div>
      </div>
      <div class="card-title">${c.name}</div>
      <div class="card-sub">${sub}</div>
    `;
    return el;
  }

  function getRecentWeightData(){
    const days = [];
    for(let i = 6; i >= 0; i -= 1){
      const iso = addDaysISO(currentISO, -i);
      const day = state.days[iso];
      const weight = Number.isFinite(day?.weight) ? day.weight : null;
      days.push({ iso, weight });
    }
    return days;
  }

  function renderWeightChart(){
    if(!weightChart || !weightValue || !weightInput) return;
    const day = getDay(state, currentISO);
    const weight = Number.isFinite(day.weight) ? day.weight : null;
    weightValue.textContent = weight ? `${weight.toFixed(1)} kg` : "Sin registro";
    weightInput.value = weight ? weight.toFixed(1) : "";

    const data = getRecentWeightData();
    const weights = data.map(d => d.weight).filter(v => Number.isFinite(v));
    weightChart.innerHTML = "";

    if(weights.length === 0){
      weightChartEmpty?.classList.remove("hidden");
      return;
    }
    weightChartEmpty?.classList.add("hidden");

    const width = 360;
    const height = 180;
    const padding = {
      top: 16,
      right: 14,
      bottom: 32,
      left: 48,
    };
    const min = Math.min(...weights);
    const max = Math.max(...weights);
    const range = Math.max(1, max - min);
    const step = data.length > 1 ? (width - padding.left - padding.right) / (data.length - 1) : 0;

    let path = "";
    const circles = [];
    const xLabels = [];
    data.forEach((d, idx) => {
      const x = padding.left + step * idx;
      const label = new Date(d.iso + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" });
      xLabels.push(`<text x="${x}" y="${height - 10}" text-anchor="middle">${label}</text>`);
      if(!Number.isFinite(d.weight)) return;
      const y = padding.top + ((max - d.weight) / range) * (height - padding.top - padding.bottom);
      path += path ? ` L ${x} ${y}` : `M ${x} ${y}`;
      circles.push(`<circle cx="${x}" cy="${y}" r="3.5" />`);
    });

    const yTicks = [max, (max + min) / 2, min];
    const yLabels = yTicks.map((val) => {
      const y = padding.top + ((max - val) / range) * (height - padding.top - padding.bottom);
      return `
        <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}"></line>
        <text x="${padding.left - 8}" y="${y + 4}" text-anchor="end">${val.toFixed(1)}</text>
      `;
    }).join("");

    weightChart.innerHTML = `
      <rect x="0" y="0" width="${width}" height="${height}" rx="14" ry="14"></rect>
      <g class="weight-grid">${yLabels}</g>
      <path d="${path}" />
      ${circles.join("")}
      <g class="weight-axis">${xLabels.join("")}</g>
    `;
    weightChart.setAttribute("viewBox", `0 0 ${width} ${height}`);
  }

  function render(){
    const day = getDay(state, currentISO);
    const { usedTotal, remaining } = getTotals(day);

    if(!["remaining", "used"].includes(state.settings.mode)){
      state.settings.mode = "remaining";
      saveState(state);
    }
    tabs.forEach(t => {
      const active = t.dataset.mode === state.settings.mode;
      t.classList.toggle("active", active);
      t.setAttribute("aria-selected", active ? "true":"false");
    });

    // Title
    dayTitleBtn.textContent = (currentISO === todayISO()) ? "Hoy" : formatDayTitle(currentISO);

    // Big number & gauge
    remainingTotalEl.textContent = remaining.toFixed(0);
    bigLabelEl.textContent = "Puntos restantes";
    setBigGauge(Math.max(0, remaining), Math.max(0.0001, state.settings.totalGoal));

    // Grid
    grid.innerHTML = "";
    state.categories.forEach(c => grid.appendChild(makeCard(c, day)));

    // Keep goal input aligned if goal modal open
    totalGoalInput.value = state.settings.totalGoal;

    renderWeightChart();
  }

  function openCategory(key){
    currentCatKey = key;
    const day = getDay(state, currentISO);
    const cat = state.categories.find(c=>c.key===key);
    if(!cat) return;

    const used = round1(day.used[key] ?? 0);
    const rem = round1(cat.goal - used);

    modalTitle.textContent = cat.name;
    modalGoal.textContent = cat.goal.toFixed(1);
    modalUsed.textContent = used.toFixed(1);
    modalRem.textContent  = rem.toFixed(1);

    // Prefill inputs
    customInput.value = "";
    goalInput.value = cat.goal;

    openModal(catModal);
  }

  function applyDeltaToCategory(key, delta){
    const day = getDay(state, currentISO);
    const before = day.used[key] ?? 0;
    const after = round1(before + delta);
    day.used[key] = Math.max(0, after);
    day.history.push({ key, delta: round1(delta), ts: Date.now() });
    saveState(state);
    render();
    // refresh modal stats if open
    if(catModal.getAttribute("aria-hidden")==="false" && currentCatKey===key){
      openCategory(key);
    }
  }

  function undoLast(){
    const day = getDay(state, currentISO);
    const last = day.history.pop();
    if(!last){ return; }
    const before = day.used[last.key] ?? 0;
    day.used[last.key] = Math.max(0, round1(before - last.delta));
    saveState(state);
    render();
    if(catModal.getAttribute("aria-hidden")==="false" && currentCatKey===last.key){
      openCategory(last.key);
    }
  }

  function parseNumber(val){
    if(typeof val !== "string") return NaN;
    // allow comma decimal
    const cleaned = val.trim().replace(",", ".");
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : NaN;
  }

  function resetDay(){
    const day = getDay(state, currentISO);
    for(const c of state.categories) day.used[c.key] = 0;
    day.history = [];
    saveState(state);
    render();
    closeModal(catModal);
  }

  function openExport(){
    exportArea.value = JSON.stringify(state, null, 2);
    openModal(exportModal);
  }

  function doImport(){
    try{
      const data = JSON.parse(exportArea.value);
      if(!data || typeof data !== "object") throw new Error("JSON inválido");
      // minimal validation
      if(!data.categories || !data.days || !data.settings) throw new Error("Faltan campos");
      state = data;
      saveState(state);
      closeModal(exportModal);
      closeModal(goalModal);
      closeModal(catModal);
      render();
      alert("Listo: importado.");
    }catch(e){
      alert("No se pudo importar: " + e.message);
    }
  }

  // Events
  grid.addEventListener("click", (e) => {
    const btn = e.target.closest(".card");
    if(!btn) return;
    openCategory(btn.dataset.key);
  });

  $$(".chip").forEach(ch => {
    ch.addEventListener("click", () => {
      const val = parseNumber(ch.dataset.add);
      if(!Number.isFinite(val) || !currentCatKey) return;
      applyDeltaToCategory(currentCatKey, val);
    });
  });

  addCustomBtn.addEventListener("click", () => {
    const val = parseNumber(customInput.value);
    if(!Number.isFinite(val) || val<=0 || !currentCatKey) return;
    applyDeltaToCategory(currentCatKey, val);
    customInput.value = "";
  });

  subCustomBtn.addEventListener("click", () => {
    const val = parseNumber(customInput.value);
    if(!Number.isFinite(val) || val<=0 || !currentCatKey) return;
    applyDeltaToCategory(currentCatKey, -val);
    customInput.value = "";
  });

  undoBtn.addEventListener("click", undoLast);

  saveGoalBtn.addEventListener("click", () => {
    if(!currentCatKey) return;
    const val = parseNumber(goalInput.value);
    if(!Number.isFinite(val) || val<0) return;
    const cat = state.categories.find(c=>c.key===currentCatKey);
    cat.goal = round1(val);
    saveState(state);
    openCategory(currentCatKey);
    render();
  });

  // Close modals
  modalCloseBtn.addEventListener("click", () => closeModal(catModal));
  goalCloseBtn.addEventListener("click", () => closeModal(goalModal));
  exportCloseBtn.addEventListener("click", () => closeModal(exportModal));
  catModal.addEventListener("click", (e) => {
    if(e.target?.dataset?.close === "1") closeModal(catModal);
  });
  goalModal.addEventListener("click", (e) => {
    if(e.target?.dataset?.close === "1") closeModal(goalModal);
  });
  exportModal.addEventListener("click", (e) => {
    if(e.target?.dataset?.close === "1") closeModal(exportModal);
  });

  // Tabs
  tabs.forEach(t => t.addEventListener("click", () => setMode(t.dataset.mode)));

  saveTotalGoalBtn.addEventListener("click", () => {
    const val = parseNumber(totalGoalInput.value);
    if(!Number.isFinite(val) || val<0) return;
    state.settings.totalGoal = round1(val);
    saveState(state);
    render();
    closeModal(goalModal);
  });

  autoFromCatsBtn.addEventListener("click", () => {
    const sum = state.categories.reduce((a,c)=>a + (c.goal ?? 0), 0);
    totalGoalInput.value = round1(sum);
  });

  // Drawer interactions
  menuBtn.addEventListener("click", () => setDrawer(true));
  drawerCloseBtn.addEventListener("click", () => setDrawer(false));
  drawerScrim.addEventListener("click", () => setDrawer(false));

  resetDayBtn.addEventListener("click", () => {
    setDrawer(false);
    if(confirm("¿Reiniciar este día? Se pondrán en 0 los usados.")) resetDay();
  });

  exportBtn.addEventListener("click", () => {
    setDrawer(false);
    openExport();
  });

  aboutBtn.addEventListener("click", () => {
    setDrawer(false);
    alert("Puntos Dieta – web app offline\n\n• Toca una categoría para sumar puntos\n• Cambia el modo con las pestañas\n• Todo se guarda localmente");
  });

  // Weight tracking
  saveWeightBtn?.addEventListener("click", () => {
    const val = parseNumber(weightInput?.value ?? "");
    if(!Number.isFinite(val) || val <= 0) return;
    const day = getDay(state, currentISO);
    day.weight = round1(val);
    saveState(state);
    renderWeightChart();
  });

  // Export copy/import
  copyExportBtn.addEventListener("click", async () => {
    try{
      await navigator.clipboard.writeText(exportArea.value);
      alert("Copiado.");
    }catch(_){
      exportArea.select();
      document.execCommand("copy");
      alert("Copiado.");
    }
  });
  importBtn.addEventListener("click", () => {
    if(confirm("¿Importar y reemplazar TODO lo guardado?")) doImport();
  });

  // Date navigation
  prevDayBtn.addEventListener("click", () => {
    currentISO = addDaysISO(currentISO, -1);
    render();
  });
  nextDayBtn.addEventListener("click", () => {
    currentISO = addDaysISO(currentISO, +1);
    render();
  });

  // Tap title to pick date
  dayTitleBtn.addEventListener("click", () => {
    datePicker.value = currentISO;
    datePicker.showPicker?.();
    datePicker.click();
  });
  datePicker.addEventListener("change", () => {
    if(datePicker.value) currentISO = datePicker.value;
    render();
  });

  // Info button quick help
  $("#infoBtn").addEventListener("click", () => {
    alert("Tip iPhone: abre esto en Safari y toca Compartir → “Agregar a pantalla de inicio” para usarlo como app.");
  });

  // Service worker (offline)
  if("serviceWorker" in navigator){
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(()=>{});
    });
  }

  // Setup Firebase Authentication login/signup listeners and sync remote state.
  // These handlers enable users to log in with email/contraseña or crear una
  // nueva cuenta. The login overlay will be shown when no user is signed
  // in and hidden when a user is authenticated. When authenticated we
  // attempt to load the user's state from Firestore and persist it
  // to localStorage for offline use. Saving of state via saveState()
  // automatically syncs to Firestore when online.
  if (auth) {
    let unsubscribeUserDoc = null;
    // Sign in with email and password
    loginBtn?.addEventListener("click", async () => {
      const email = loginEmailInput?.value?.trim();
      const pass  = loginPasswordInput?.value ?? "";
      if (!email || !pass) {
        alert("Por favor introduce tu email y contraseña.");
        return;
      }
      try {
        await auth.signInWithEmailAndPassword(email, pass);
      } catch (err) {
        alert("No se pudo iniciar sesión: " + (err?.message || err));
      }
    });
    // Register a new account
    signupBtn?.addEventListener("click", async () => {
      const email = loginEmailInput?.value?.trim();
      const pass  = loginPasswordInput?.value ?? "";
      if (!email || !pass) {
        alert("Por favor introduce tu email y contraseña.");
        return;
      }
      try {
        await auth.createUserWithEmailAndPassword(email, pass);
        alert("Cuenta creada. Ya puedes comenzar a usar la app.");
      } catch (err) {
        alert("No se pudo crear la cuenta: " + (err?.message || err));
      }
    });
    // Observe auth state changes
    auth.onAuthStateChanged(async (user) => {
      if (user) {
        // hide login overlay
        toggleLoginScreen(false);
        if (unsubscribeUserDoc) {
          unsubscribeUserDoc();
        }
        // Load state from Firestore in real time
        if (db) {
          unsubscribeUserDoc = db.collection("users").doc(user.uid).onSnapshot((doc) => {
            if (doc && doc.exists) {
              const remoteState = doc.data();
              if (remoteState && remoteState.categories && remoteState.days && remoteState.settings) {
                state = remoteState;
              }
            } else {
              state = initState();
            }
            render();
          }, () => {
            // ignore Firestore errors
          });
        }
      } else {
        // no user: show login overlay
        toggleLoginScreen(true);
        if (unsubscribeUserDoc) {
          unsubscribeUserDoc();
          unsubscribeUserDoc = null;
        }
        state = loadState() ?? initState();
        render();
      }
    });

    $("#logoutBtn")?.addEventListener("click", async () => {
      setDrawer(false);
      if (!auth.currentUser) {
        alert("No hay sesión activa.");
        return;
      }
      if (!confirm("¿Cerrar sesión?")) return;
      try {
        await auth.signOut();
      } catch (err) {
        alert("No se pudo cerrar sesión: " + (err?.message || err));
      }
    });

    // Initially show login overlay until auth state determines otherwise.
    toggleLoginScreen(true);
  }

  // First render
  render();
})();
