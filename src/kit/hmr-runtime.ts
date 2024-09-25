// This file is the entrypoint to the hot-module-reloading runtime
// In the browser, this uses a WebSocket to communicate with the bundler.
// On the server, communication is facilitated using a secret global.
import { showErrorOverlay } from "./client/overlay";
import { loadModule } from "./hmr-module";

if (typeof IS_BUN_DEVELOPMENT !== "boolean") {
  throw new Error("DCE is configured incorrectly");
}

// Initialize client-side features.
if (mode === "client") {
  const { refresh } = config;
  if (refresh) {
    const runtime = loadModule(refresh).exports;
    runtime.injectIntoGlobalHook(window);
  }
}

// Load the entry point module
try {
  const main = loadModule(config.main);

  // export it on the server side
  if (mode === "server") server_fetch_function = main.exports.default;

  if (mode === "client") {
    const ws = new WebSocket("/_bun/hmr");
    ws.onopen = ev => {
      console.log(ev);
    };
    ws.onmessage = ev => {
      console.log(ev);
    };
    ws.onclose = ev => {
      console.log(ev);
    };
    ws.onerror = ev => {
      console.log(ev);
    };
  }
} catch (e) {
  if (mode !== "client") throw e;
  showErrorOverlay(e);
}

export {};
