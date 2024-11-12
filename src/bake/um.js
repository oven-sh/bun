__marker__;
var input_graph, config, server_exports, requireFunctionProvidedByBakeCodegen, $separateSSRGraph;
__marker__(input_graph, config, server_exports, requireFunctionProvidedByBakeCodegen, $separateSSRGraph);
var __defProp = Object.defineProperty, __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, {
      get: all[name],
      enumerable: !0,
      configurable: !0,
      set: (newValue) => all[name] = () => newValue
    });
}, exports_runtime_bun = {};
__export(exports_runtime_bun, {
  __using: () => __using,
  __toESM: () => __toESM,
  __toCommonJS: () => __toCommonJS,
  __reExport: () => __reExport,
  __name: () => __name,
  __merge: () => __merge,
  __legacyMetadataTS: () => __legacyMetadataTS,
  __legacyDecorateParamTS: () => __legacyDecorateParamTS,
  __legacyDecorateClassTS: () => __legacyDecorateClassTS,
  __exportValue: () => __exportValue,
  __exportDefault: () => __exportDefault,
  __export: () => __export2,
  __esm: () => __esm,
  __commonJS: () => __commonJS,
  __callDispose: () => __callDispose,
  $$typeof: () => $$typeof
});
var { create: __create, getOwnPropertyDescriptors: __descs, getPrototypeOf: __getProtoOf, defineProperty: __defProp2, getOwnPropertyNames: __getOwnPropNames, getOwnPropertyDescriptor: __getOwnPropDesc } = Object, __hasOwnProp = Object.prototype.hasOwnProperty, __reExport = (target, mod, secondTarget) => {
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(target, key) && key !== "default")
      __defProp2(target, key, {
        get: () => mod[key],
        enumerable: !0
      });
  if (secondTarget) {
    for (let key of __getOwnPropNames(mod))
      if (!__hasOwnProp.call(secondTarget, key) && key !== "default")
        __defProp2(secondTarget, key, {
          get: () => mod[key],
          enumerable: !0
        });
    return secondTarget;
  }
}, __toESM = (mod, isNodeMode, target) => {
  target = mod != null ? __create(__getProtoOf(mod)) : {};
  let to = isNodeMode || !mod || !mod.__esModule ? __defProp2(target, "default", { value: mod, enumerable: !0 }) : target;
  for (let key of __getOwnPropNames(mod))
    if (!__hasOwnProp.call(to, key))
      __defProp2(to, key, {
        get: () => mod[key],
        enumerable: !0
      });
  return to;
}, __moduleCache = /* @__PURE__ */ new WeakMap, __toCommonJS = (from) => {
  var entry = __moduleCache.get(from), desc;
  if (entry)
    return entry;
  if (entry = __defProp2({}, "__esModule", { value: !0 }), from && typeof from === "object" || typeof from === "function")
    __getOwnPropNames(from).map((key) => !__hasOwnProp.call(entry, key) && __defProp2(entry, key, {
      get: () => from[key],
      enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
    }));
  return __moduleCache.set(from, entry), entry;
}, __commonJS = (cb, mod) => () => (mod || cb((mod = { exports: {} }).exports, mod), mod.exports), __name = (target, name) => {
  return Object.defineProperty(target, "name", {
    value: name,
    enumerable: !1,
    configurable: !0
  }), target;
}, __export2 = (target, all) => {
  for (var name in all)
    __defProp2(target, name, {
      get: all[name],
      enumerable: !0,
      configurable: !0,
      set: (newValue) => all[name] = () => newValue
    });
}, __exportValue = (target, all) => {
  for (var name in all)
    __defProp2(target, name, {
      get: () => all[name],
      set: (newValue) => all[name] = newValue,
      enumerable: !0,
      configurable: !0
    });
}, __exportDefault = (target, value) => {
  __defProp2(target, "default", {
    get: () => value,
    set: (newValue) => value = newValue,
    enumerable: !0,
    configurable: !0
  });
};
function __hasAnyProps(obj) {
  for (let key in obj)
    return !0;
  return !1;
}
function __mergeDefaultProps(props, defaultProps) {
  var result = __create(defaultProps, __descs(props));
  for (let key in defaultProps) {
    if (result[key] !== void 0)
      continue;
    result[key] = defaultProps[key];
  }
  return result;
}
var __merge = (props, defaultProps) => {
  return !__hasAnyProps(defaultProps) ? props : !__hasAnyProps(props) ? defaultProps : __mergeDefaultProps(props, defaultProps);
}, __legacyDecorateClassTS = function(decorators, target, key, desc) {
  var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function")
    r = Reflect.decorate(decorators, target, key, desc);
  else
    for (var i = decorators.length - 1;i >= 0; i--)
      if (d = decorators[i])
        r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key, r), r;
}, __legacyDecorateParamTS = (index, decorator) => (target, key) => decorator(target, key, index), __legacyMetadataTS = (k, v) => {
  if (typeof Reflect === "object" && typeof Reflect.metadata === "function")
    return Reflect.metadata(k, v);
}, __esm = (fn, res) => () => (fn && (res = fn(fn = 0)), res), $$typeof = /* @__PURE__ */ Symbol.for("react.element"), __using = (stack, value, async) => {
  if (value != null) {
    if (typeof value !== "object" && typeof value !== "function")
      throw TypeError('Object expected to be assigned to "using" declaration');
    let dispose;
    if (async)
      dispose = value[Symbol.asyncDispose];
    if (dispose === void 0)
      dispose = value[Symbol.dispose];
    if (typeof dispose !== "function")
      throw TypeError("Object not disposable");
    stack.push([async, dispose, value]);
  } else if (async)
    stack.push([async]);
  return value;
}, __callDispose = (stack, error, hasError) => {
  let fail = (e) => error = hasError ? new SuppressedError(e, error, "An error was suppressed during disposal") : (hasError = !0, e), next = (it) => {
    while (it = stack.pop())
      try {
        var result = it[1] && it[1].call(it[2]);
        if (it[0])
          return Promise.resolve(result).then(next, (e) => (fail(e), next()));
      } catch (e) {
        fail(e);
      }
    if (hasError)
      throw error;
  };
  return next();
}, registry = /* @__PURE__ */ new Map;

class HotModule {
  id;
  exports = {};
  _state = 0;
  _ext_exports = void 0;
  __esModule = !1;
  _import_meta = void 0;
  _cached_failure = void 0;
  _deps = /* @__PURE__ */ new Map;
  constructor(id) {
    this.id = id;
  }
  require(id, onReload) {
    let mod = loadModule(id, 1);
    return mod._deps.set(this, onReload), mod.exports;
  }
  importSync(id, onReload) {
    let mod = loadModule(id, 0);
    mod._deps.set(this, onReload);
    let { exports, __esModule } = mod;
    return __esModule ? exports : mod._ext_exports ??= { ...exports, default: exports };
  }
  async dynamicImport(specifier, opts) {
    let mod = loadModule(specifier, 1);
    mod._deps.set(this, mod._deps.get(this));
    let { exports, __esModule } = mod;
    return __esModule ? exports : mod._ext_exports ??= { ...exports, default: exports };
  }
  importMeta() {
    return this._import_meta ??= initImportMeta(this);
  }
}
HotModule.prototype.importBuiltin = function(id) {
  return requireFunctionProvidedByBakeCodegen(id);
};
function initImportMeta(m) {
  throw new Error("TODO: import meta object");
}
function loadModule(key, type) {
  console.log("loadModule", key, type === 0 ? "AssertPresent" : "UserDynamic");
  let module = registry.get(key);
  if (module) {
    if (module._state == 2)
      throw module._cached_failure;
    return module;
  }
  module = new HotModule(key);
  let load = input_graph[key];
  if (!load)
    if (type == 0)
      throw new Error(`Failed to load bundled module '${key}'. This is not a dynamic import, and therefore is a bug in Bun Kit's bundler.`);
    else
      throw new Error(`Failed to resolve dynamic import '${key}'. In Bun Kit, all imports must be statically known at compile time so that the bundler can trace everything.`);
  try {
    registry.set(key, module), console.log("about to load "), load(module);
  } catch (err) {
    throw console.log("caught failure"), console.error(err), module._cached_failure = err, module._state = 2, err;
  }
  return module;
}
var getModule = registry.get.bind(registry);
function replaceModule(key, load) {
  let module = registry.get(key);
  if (module) {
    module.exports = {}, load(module);
    let { exports } = module;
    for (let updater of module._deps.values())
      updater?.(exports);
  }
}
function replaceModules(modules) {
  for (let k in modules)
    input_graph[k] = modules[k];
  for (let k in modules)
    try {
      replaceModule(k, modules[k]);
    } catch (err) {
      console.error(err);
    }
}
{
  let runtime2 = new HotModule("bun:wrap");
  runtime2.exports = exports_runtime_bun, runtime2.__esModule = !0, registry.set("bun:wrap", runtime2);
}
var serverManifest = {}, clientManifest = {};
{
  let server_module = new HotModule("bun:bake/server");
  server_module.__esModule = !0, server_module.exports = { serverManifest, clientManifest }, registry.set(server_module.id, server_module);
}
__name(HotModule.prototype.importSync, "<HMR runtime> importSync");
__name(HotModule.prototype.require, "<HMR runtime> require");
__name(loadModule, "<HMR runtime> loadModule");
server_exports = {
  async handleRequest(req, routeModules, clientEntryUrl, styles, params) {
    let serverRenderer = loadModule(config.main, 0).exports.render;
    if (!serverRenderer)
      throw new Error('Framework server entrypoint is missing a "render" export.');
    if (typeof serverRenderer !== "function")
      throw new Error('Framework server entrypoint\'s "render" export is not a function.');
    let [pageModule, ...layouts] = routeModules.map((id) => loadModule(id, 0).exports), response = await serverRenderer(req, {
      styles,
      scripts: [clientEntryUrl],
      layouts,
      pageModule,
      modulepreload: [],
      params
    });
    if (!(response instanceof Response))
      throw new Error("Server-side request handler was expected to return a Response object.");
    return response;
  },
  registerUpdate(modules, componentManifestAdd, componentManifestDelete) {
    if (replaceModules(modules), componentManifestAdd)
      for (let uid of componentManifestAdd)
        try {
          let mod = loadModule(uid, 0), { exports, __esModule } = mod, exp = __esModule ? exports : mod._ext_exports ??= { ...exports, default: exports }, client = {};
          for (let exportName of Object.keys(exp))
            serverManifest[uid] = {
              id: uid,
              name: exportName,
              chunks: []
            }, client[exportName] = {
              specifier: "ssr:" + uid,
              name: exportName
            };
          clientManifest[uid] = client;
        } catch (err) {
          console.log("caught error"), console.log(err);
        }
    if (componentManifestDelete)
      for (let fileName of componentManifestDelete) {
        let client = clientManifest[fileName];
        for (let exportName in client)
          delete serverManifest[`${fileName}#${exportName}`];
        delete clientManifest[fileName];
      }
  }
};