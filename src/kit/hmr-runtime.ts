// This file is the entrypoint to the hot-module-reloading runtime
// In the browser, this uses a WebSocket to communicate with the bundler.
// On the server, communication is facilitated using a secret global.
import { loadModule, LoadModuleType, replaceModules } from './hmr-module';
import { showErrorOverlay } from './client/overlay';
import { initHmrWebSocket } from './client/websocket';

if (typeof IS_BUN_DEVELOPMENT !== "boolean") {
  throw new Error("DCE is configured incorrectly");
}


// Client-side features.
if (mode === 'client') {
  try {

    const main = loadModule(config.main, LoadModuleType.AssertPresent);

    if (Object.keys(main.exports).length > 0) {
      console.warn(`Framework client entry point (${config.main}) was not expected to export anything, found: ${Object.keys(main.exports).join(', ')}`);
    }

    initHmrWebSocket();
  } catch (e) {
    if (mode !== "client") throw e;
    showErrorOverlay(e);
  }
}

// Server Side
if (mode === 'server')  {
  server_exports = {
    async handleRequest({ clientEntryPoint }: any, requested_id: Id) {
      const serverRenderer = loadModule(config.main, LoadModuleType.AssertPresent).exports.default;
      if (!serverRenderer) {
        throw new Error('Framework server entrypoint is missing a "default" export.');
      }
      if (typeof serverRenderer !== 'function') {
        throw new Error('Framework server entrypoint\'s "default" export is not a function.');
      }
      // TODO: create the request object in Native code, consume Response in Native code
      // The API that i have in mind is faked here for the time being.
      const response = await serverRenderer(
        new Request('http://localhost:3000'),
        loadModule(requested_id, LoadModuleType.AssertPresent).exports,
        { 
          styles: [],
          scripts: [clientEntryPoint],
        }
      );
      if (!(response instanceof Response)) {
        throw new Error(`Server-side request handler was expected to return a Response object.`);
      }
      // TODO: support streaming
      return await response.text();
    },
    registerUpdate: replaceModules,
  };
}

