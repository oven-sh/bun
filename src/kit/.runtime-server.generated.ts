
    __marker__;
    let input_graph,config,server_fetch_function;
    __marker__(input_graph,config,server_fetch_function);
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

// hmr-runtime.ts
try {
  const main = loadModule(config.main);
  server_fetch_function = main.exports.default;
} catch (e) {
  throw e;
}
;
  