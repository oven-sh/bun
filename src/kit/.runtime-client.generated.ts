
    __marker__;
    let input_graph,config;
    __marker__(input_graph,config);
    // ../runtime.js
var __name = (target, name) => {
  return Object.defineProperty(target, "name", {
    value: name,
    enumerable: !1,
    configurable: !0
  }), target;
};
// hmr-module.ts
function initImportMeta(m) {
  throw new Error("TODO: import meta object");
}
function loadModule(key) {
  let module = registry.get(key);
  if (module)
    return module;
  module = new HotModule(key), registry.set(key, module);
  const load = input_graph[key];
  if (!load)
    throw new Error(`Failed to load bundled module '${key}'. This is not a dynamic import, and therefore is a bug in Bun`);
  return load(module), module;
}
var registry = /* @__PURE__ */ new Map;

class HotModule {
  id;
  exports = {};
  _ext_exports = void 0;
  __esModule = !1;
  _import_meta;
  constructor(id) {
    this.id = id;
  }
  require(id, onReload) {
    return loadModule(id).exports;
  }
  importSync(id, onReload) {
    const module = loadModule(id), { exports, __esModule } = module;
    return __esModule ? exports : module._ext_exports ??= { ...exports, default: exports };
  }
  importMeta() {
    return this._import_meta ??= initImportMeta(this);
  }
}
__name(HotModule.prototype.importSync, "<HMR runtime> importSync");
__name(HotModule.prototype.require, "<HMR runtime> require");
__name(loadModule, "<HMR runtime> loadModule");

// client/overlay.ts
function showErrorOverlay(e) {
  mount(), console.error(e), root.innerHTML = `<div class='error'><h1>oh no, a client side error happened:</h1><pre><code>${e?.message ? `${e?.name ?? e?.constructor?.name ?? "Error"}: ${e.message}\n` : JSON.stringify(e)}${e?.message ? e?.stack : ""}</code></pre></div>`;
}
var root, mount;
mount = function mount() {
  const wrap = document.createElement("bun-hmr");
  wrap.setAttribute("style", "position:absolute;display:block;top:0;left:0;width:100%;height:100%;background:transparent");
  const shadow = wrap.attachShadow({ mode: "open" }), sheet = new CSSStyleSheet;
  sheet.replace(`/*
 * This file is mounted within Shadow DOM so interference with
 * the user's application causes no issue. This sheet is used to
 * style error popups and other elements provided by DevServer.
 */

* {
  box-sizing: border-box;
}

main {
  font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
}

.error {
  padding: 1rem;
  background-color: rgba(255, 0, 0, 0.2);
}`), shadow.adoptedStyleSheets = [sheet], root = document.createElement("main"), shadow.appendChild(root), document.body.appendChild(wrap);
};

// hmr-runtime.ts
{
  const { refresh } = config;
  if (refresh)
    loadModule(refresh).exports.injectIntoGlobalHook(window);
}
try {
  const main = loadModule(config.main);
  {
    const ws = new WebSocket("/_bun/hmr");
    ws.onopen = (ev) => {
      console.log(ev);
    }, ws.onmessage = (ev) => {
      console.log(ev);
    }, ws.onclose = (ev) => {
      console.log(ev);
    }, ws.onerror = (ev) => {
      console.log(ev);
    };
  }
} catch (e) {
  showErrorOverlay(e);
}
;
  