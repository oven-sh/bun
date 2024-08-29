import { css } from './runtime-macros' with { type: 'macro' };

/**
 * All modules for the initial bundle. The first one is the entrypoint.
 */
declare const graph: Record<string, ModuleLoadFunction>;
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

type RequireFunction = (id: string) => void;
type ModuleLoadFunction = (require: RequireFunction, module) => void;

interface ModuleEntry {
  exports: any;
}

console.log(graph, 'mode: ' + mode);

const loaded_modules = new Map<string, ModuleEntry>()

function loadModule(key: string) {
  let module = loaded_modules.get(key);
  if(module) return module.exports;
  module = {
    exports: {},
  };
  loaded_modules.set(key, module);
  graph[key](loadModule, module);
  return module.exports;
}

if (mode == 'client') {
  const style = document.createElement('style');
  style.innerHTML = css('overlay.css', IS_BUN_DEVELOPMENT);
  document.head.appendChild(style);
}

// Load the entry point module
loadModule(entry_point_key);

export {}
