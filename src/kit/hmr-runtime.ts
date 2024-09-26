// This file is the entrypoint to the hot-module-reloading runtime
// In the browser, this uses a WebSocket to communicate with the bundler.
// On the server, communication is facilitated using a secret global.
import { loadModule, LoadModuleType, replaceModule } from './hmr-module';
import { showErrorOverlay } from './client/overlay';

if (typeof IS_BUN_DEVELOPMENT !== 'boolean') { throw new Error('DCE is configured incorrectly') }

// Initialize client-side features.
if (mode === 'client') {
  var refresh_runtime: any;
  // var { refresh } = config;
  var refresh = "node_modules/react-refresh/cjs/react-refresh-runtime.development.js";
  if (refresh) {
    refresh_runtime = loadModule(refresh, LoadModuleType.AssertPresent).exports;
    refresh_runtime.injectIntoGlobalHook(window);
  }
}

// Load the entry point module
try {
  const main = loadModule(config.main, LoadModuleType.AssertPresent);
  
  if (mode === 'server')  {
    server_exports = {
      async fetch(req: any, requested_id: Id) {
        const serverRenderer = main.exports.default;
        if (!serverRenderer) {
          throw new Error('Framework server entrypoint is missing a "default" export.');
        }
        if (typeof serverRenderer !== 'function') {
          throw new Error('Framework server entrypoint\'s "default" export is not a function.');
        }
        // TODO: create the request object in Native code, consume Response in Native code
        const response = await serverRenderer(
          new Request('http://localhost:3000'),
          loadModule(requested_id, LoadModuleType.AssertPresent).exports
        );
        if (!(response instanceof Response)) {
          throw new Error(`Server-side request handler was expected to return a Response object.`);
        }
        // TODO: support streaming
        return await response.text();
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
