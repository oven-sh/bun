import * as runtimeHelpers from "../runtime.bun.js";

let refreshRuntime: any;
const registry = new Map<Id, HotModule>();

export type ModuleLoadFunction = (module: HotModule) => void;
export type ExportsCallbackFunction = (new_exports: any) => void;

export const enum State {
  Loading,
  Boundary,
  Error,
}

export const enum LoadModuleType {
  AssertPresent,
  UserDynamic,
}

/**
 * This object is passed as the CommonJS "module", but has a bunch of
 * non-standard properties that are used for implementing hot-module
 * reloading. It is unacceptable to depend on these properties, and
 * it will not be considered a breaking change.
 */
export class HotModule<E = any> {
  id: Id;
  exports: E = {} as E;

  _state = State.Loading;
  _ext_exports = undefined;
  __esModule = false;
  _import_meta: ImportMeta | undefined = undefined;
  _cached_failure: any = undefined;
  // modules that import THIS module
  _deps: Map<HotModule, ExportsCallbackFunction | undefined> = new Map();

  constructor(id: Id) {
    this.id = id;
  }

  require(id: Id, onReload?: ExportsCallbackFunction) {
    const mod = loadModule(id, LoadModuleType.UserDynamic);
    mod._deps.set(this, onReload);
    return mod.exports;
  }

  importSync(id: Id, onReload?: ExportsCallbackFunction) {
    const mod = loadModule(id, LoadModuleType.AssertPresent);
    // insert into the map if not present
    mod._deps.set(this, onReload);
    const { exports, __esModule } = mod;
    return __esModule ? exports : (mod._ext_exports ??= { ...exports, default: exports });
  }

  async dynamicImport(specifier: string, opts?: ImportCallOptions) {
    const mod = loadModule(specifier, LoadModuleType.UserDynamic);
    // insert into the map if not present
    mod._deps.set(this, mod._deps.get(this));
    const { exports, __esModule } = mod;
    return __esModule ? exports : (mod._ext_exports ??= { ...exports, default: exports });
  }

  importMeta() {
    return (this._import_meta ??= initImportMeta(this));
  }

  /** Server-only */
  declare importBuiltin: (id: string) => any;
}

if (side === "server") {
  HotModule.prototype.importBuiltin = function (id: string) {
    return import.meta.require(id);
  };
}

function initImportMeta(m: HotModule): ImportMeta {
  throw new Error("TODO: import meta object");
}

/**
 * Load a module by ID. Use `type` to specify if the module is supposed to be
 * present, or is something a user is able to dynamically specify.
 */
export function loadModule<T = any>(key: Id, type: LoadModuleType): HotModule<T> {
  let module = registry.get(key);
  if (module) {
    // Preserve failures until they are re-saved.
    if (module._state == State.Error) throw module._cached_failure;

    return module;
  }
  module = new HotModule(key);
  const load = input_graph[key];
  if (!load) {
    if (type == LoadModuleType.AssertPresent) {
      throw new Error(
        `Failed to load bundled module '${key}'. This is not a dynamic import, and therefore is a bug in Bun Kit's bundler.`,
      );
    } else {
      throw new Error(
        `Failed to resolve dynamic import '${key}'. In Bun Kit, all imports must be statically known at compile time so that the bundler can trace everything.`,
      );
    }
  }
  try {
    registry.set(key, module);
    load(module);
  } catch (err) {
    module._cached_failure = err;
    module._state = State.Error;
    throw err;
  }
  return module;
}

export function replaceModule(key: Id, load: ModuleLoadFunction) {
  const module = registry.get(key);
  if (module) {
    module.exports = {};
    load(module);
    const { exports } = module;
    for (const updater of module._deps.values()) {
      updater?.(exports);
    }
  }
}

export function replaceModules(modules: any) {
  for (const k in modules) {
    input_graph[k] = modules[k];
  }
  for (const k in modules) {
    try {
      replaceModule(k, modules[k]);
    } catch (err) {
      // TODO: overlay for client
      console.error(err);
    }
  }
  if (side === "client" && refreshRuntime) {
    refreshRuntime.performReactRefresh(window);
  }
}

{
  const runtime = new HotModule("bun:wrap");
  runtime.exports = runtimeHelpers;
  runtime.__esModule = true;
  registry.set("bun:wrap", runtime);
}

if (side === "client") {
  const { refresh } = config;
  if (refresh) {
    refreshRuntime = loadModule(refresh, LoadModuleType.AssertPresent).exports;
    refreshRuntime.injectIntoGlobalHook(window);
  }
}

// TODO: Remove this after `react-server-dom-bun` is uploaded
globalThis.__webpack_require__ = (id: string) => {
  if (side == "server" && config.separateSSRGraph && !id.startsWith("ssr:")) {
    return loadModule("ssr:" + id, LoadModuleType.UserDynamic).exports;
  } else {
    return loadModule(id, LoadModuleType.UserDynamic).exports;
  }
};

runtimeHelpers.__name(HotModule.prototype.importSync, "<HMR runtime> importSync");
runtimeHelpers.__name(HotModule.prototype.require, "<HMR runtime> require");
runtimeHelpers.__name(loadModule, "<HMR runtime> loadModule");
