import * as runtimeHelpers from '../runtime.bun.js';

const registry = new Map<Id, HotModule>()

export type ModuleLoadFunction = (module: HotModule) => void;
export type ExportsCallbackFunction = (new_exports: any) => void;

export const enum State {
  Loading,
  Error,
}

/**
 * This object is passed as the CommonJS "module", but has a bunch of
 * non-standard properties that are used for implementing hot-module
 * reloading. It is unacceptable to depend on these properties, and
 * it will not be considered a breaking change.
 * 
 * TODO: consider property mangling on this to prevent people
 * depending on the HMR internals
 */
export class HotModule {
  exports: any = {};

  _state = State.Loading;
  _ext_exports = undefined;
  __esModule = false;
  _import_meta: ImportMeta | undefined = undefined;
  _cached_failure: any = undefined;

  constructor(public id: Id) {}

  require(id: Id, onReload: null | ExportsCallbackFunction) {
    return loadModule(id).exports;
  }

  importSync(id: Id, onReload: null | ExportsCallbackFunction) {
    const module = loadModule(id);
    const { exports, __esModule } = module;
    return __esModule
      ? exports
      : module._ext_exports ??= { ...exports, default: exports };
  }

  importMeta() {
    return this._import_meta ??= initImportMeta(this);
  }

  importBuiltin(id: string) {
    return import.meta.require(id);
  }
}

function initImportMeta(m: HotModule): ImportMeta {
  throw new Error("TODO: import meta object");
}

// {
//   const runtime = new HotModule(0);
//   runtime.exports = runtimeHelpers;
//   runtime.__esModule = true;
//   registry.set(0, runtime);
// }

export function loadModule(key: Id): HotModule {
  let module = registry.get(key);
  if (module) {
    // Preserve failures until they are re-saved.
    if (module._state == State.Error)
      throw module._cached_failure;

    return module;
  }
  module = new HotModule(key);
  const load = input_graph[key];
  if (!load) {
    throw new Error(`Failed to load bundled module '${key}'. This is not a dynamic import, and therefore is a bug in Bun.`);
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
    // TODO: repair live bindings
  }
}

runtimeHelpers.__name(HotModule.prototype.importSync, '<HMR runtime> importSync')
runtimeHelpers.__name(HotModule.prototype.require, '<HMR runtime> require')
runtimeHelpers.__name(loadModule, '<HMR runtime> loadModule')
