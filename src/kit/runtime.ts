import { css } from './runtime-macros' with { type: 'macro' };

/**
 * All modules for the initial bundle. The first one is the entrypoint.
 */
declare const input_graph: Record<string, ModuleLoadFunction>;
/** The entrypoint's key */
declare const entry_point_key: string;
/**
 * The runtime is bundled for server and client, which influences
 * how hmr connection should be established, as well if there is
 * a window to visually display errors with.
*/
declare const mode: 'client' | 'server';

declare const IS_BUN_DEVELOPMENT: any;
if (typeof IS_BUN_DEVELOPMENT !== 'boolean') { throw new Error('DCE is configured incorrectly') }

const registry = new Map<string, HotModule>()

type ModuleLoadFunction = (module: HotModule) => void;
type ExportsCallbackFunction = (new_exports: any) => void;

/**
 * This object is passed as the CommonJS "module", but has a bunch of
 * non-standard properties that are used for implementing hot-module
 * reloading. It is unacceptable to depend 
 */
class HotModule {
  exports = {};

  _ext_exports = {};
  __esModule = false;

  constructor(public id: string) {}

  require(key: string, onReload: null | ExportsCallbackFunction) {
    return loadModule(key).exports;
  }

  importSync(key: string, callbacks: null | ExportsCallbackFunction) {
    const module = loadModule(key);
    if (callbacks) {
      const { exports, __esModule } = module;
      return __esModule
        ? module._ext_exports ??= { ...exports, default: exports }
        : exports;
    }
  }
}

function loadModule(key: string): HotModule {
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

// if (mode == 'client') {
//   const style = document.createElement('style');
//   style.innerHTML = css('overlay.css', IS_BUN_DEVELOPMENT);
//   document.head.appendChild(style);
// }

// Load the entry point module
loadModule(entry_point_key);

export {}
