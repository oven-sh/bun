// This file is the entrypoint to the hot-module-reloading runtime
// In the browser, this uses a WebSocket to communicate with the bundler.
// On the server, communication is facilitated using a secret global.
import { loadModule, replaceModule } from './hmr-module';
import { showErrorOverlay } from './client/overlay';

if (typeof IS_BUN_DEVELOPMENT !== 'boolean') { throw new Error('DCE is configured incorrectly') }

// Initialize client-side features.
if (mode === 'client') {
  var refresh_runtime: any;
  // var { refresh } = config;
  var refresh = "node_modules/react-refresh/cjs/react-refresh-runtime.development.js";
  if (refresh) {
    refresh_runtime = loadModule(refresh).exports;
    refresh_runtime.injectIntoGlobalHook(window);
  }
}

// Load the entry point module
try {
  const main = loadModule(config.main);
  
  if (mode === 'server')  {
    server_exports = {
      fetch(req: any, requested_id: Id) {
        return main.exports.default(loadModule(requested_id).exports);
      },
      registerUpdate(modules) {
        throw new Error('erm... you want me to what')
      },
    };
  }

  if (mode === 'client') {
    const ws = new WebSocket('/_bun/hmr');
    ws.onopen = (ev) => {
      console.log('Open!');
    }
    ws.onmessage = (ev) => {
      if(typeof ev.data === 'string') {
        console.log(ev.data);
        if(ev.data !== 'bun!') {
          const evaluated = (0, eval)(ev.data);
          for (const k in evaluated) {
            input_graph[k] = evaluated[k];
          }
          for (const k in evaluated) {
            replaceModule(k, evaluated[k]);
          }
          if (refresh) {
            refresh_runtime.performReactRefresh();
          }
        }
      }
    }
    ws.onclose = (ev) => {
      console.log("Closed");
    }
    ws.onerror = (ev) => {
      console.error(ev);
    }
  }
} catch (e) {
  if (mode !== 'client') throw e;
  showErrorOverlay(e);
}

export {}
