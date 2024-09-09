import * as runtimeHelpers from '../runtime.bun.js';

const registry = new Map<Id, HotModule>()

export type ModuleLoadFunction = (module: HotModule) => void;
export type ExportsCallbackFunction = (new_exports: any) => void;

/**
 * This object is passed as the CommonJS "module", but has a bunch of
 * non-standard properties that are used for implementing hot-module
 * reloading. It is unacceptable to depend 
 */
export class HotModule {
  exports: any = {};

  _ext_exports = undefined;
  __esModule = false;
  _import_meta?: ImportMeta;

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
  if (module) return module;
  module = new HotModule(key);
  registry.set(key, module);
  const load = input_graph[key];
  if (!load) {
    throw new Error(`Failed to load bundled module '${key}'. This is not a dynamic import, and therefore is a bug in Bun`);
  }
  load(module);
  return module;
}

runtimeHelpers.__name(HotModule.prototype.importSync, '<HMR runtime> importSync')
runtimeHelpers.__name(HotModule.prototype.require, '<HMR runtime> require')
runtimeHelpers.__name(loadModule, '<HMR runtime> loadModule')
