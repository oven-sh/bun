// This file is the 
import { loadModule } from './hmr-module';
import { showErrorOverlay } from './client/overlay';

if (typeof IS_BUN_DEVELOPMENT !== 'boolean') { throw new Error('DCE is configured incorrectly') }

// Initialize client-side features.
if (mode === 'client') {
  const { refresh } = config;
  if(refresh) {
    const runtime = loadModule(refresh).exports;
    runtime.injectIntoGlobalHook(window);
  }
}

// Load the entry point module
try {
  const main = loadModule(config.main);
  
  // export it on the server side
  if (mode === 'server') 
    server_fetch_function = main.exports.default;
} catch (e) {
  if (mode !== 'client') throw e;
  showErrorOverlay(e);
}


export {}
