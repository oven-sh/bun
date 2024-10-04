// This file is the entrypoint to the hot-module-reloading runtime.
// On the server, communication is facilitated using the default
// export, which is assigned via `server_exports`.
import type { Bake } from "bun";
import { loadModule, LoadModuleType, replaceModules } from "./hmr-module";

if (typeof IS_BUN_DEVELOPMENT !== "boolean") {
  throw new Error("DCE is configured incorrectly");
}

// Server Side
server_exports = {
  async handleRequest(req, { clientEntryPoint }, requested_id) {
    const serverRenderer = loadModule<Bake.ServerEntryPoint>(config.main, LoadModuleType.AssertPresent).exports
      .default;

    if (!serverRenderer) {
      throw new Error('Framework server entrypoint is missing a "default" export.');
    }
    if (typeof serverRenderer !== "function") {
      throw new Error('Framework server entrypoint\'s "default" export is not a function.');
    }

    const response = await serverRenderer(req, loadModule(requested_id, LoadModuleType.AssertPresent).exports, {
      styles: [],
      scripts: [clientEntryPoint],
    });

    if (!(response instanceof Response)) {
      throw new Error(`Server-side request handler was expected to return a Response object.`);
    }

    // TODO: support streaming
    return await response.text();
  },
  registerUpdate: replaceModules,
};
