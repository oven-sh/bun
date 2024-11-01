// This file is the entrypoint to the hot-module-reloading runtime.
// On the server, communication is facilitated using the default
// export, which is assigned via `server_exports`.
import type { Bake } from "bun";
import { loadModule, LoadModuleType, replaceModules, clientManifest, serverManifest, getModule } from "./hmr-module";

if (typeof IS_BUN_DEVELOPMENT !== "boolean") {
  throw new Error("DCE is configured incorrectly");
}

server_exports = {
  async handleRequest(req, routeModuleId, clientEntryUrl, styles) {
    const serverRenderer = loadModule<Bake.ServerEntryPoint>(config.main, LoadModuleType.AssertPresent).exports.default;

    if (!serverRenderer) {
      throw new Error('Framework server entrypoint is missing a "default" export.');
    }
    if (typeof serverRenderer !== "function") {
      throw new Error('Framework server entrypoint\'s "default" export is not a function.');
    }

    const response = await serverRenderer(req, loadModule(routeModuleId, LoadModuleType.AssertPresent).exports, {
      styles: styles,
      scripts: [clientEntryUrl],
      devRoutePath: routeModuleId,
    });

    if (!(response instanceof Response)) {
      throw new Error(`Server-side request handler was expected to return a Response object.`);
    }

    // TODO: support streaming
    return await response.text();
  },
  registerUpdate(modules, componentManifestAdd, componentManifestDelete) {
    replaceModules(modules);

    if (componentManifestAdd) {
      for (const uid of componentManifestAdd) {
        try {
          const mod = loadModule(uid, LoadModuleType.AssertPresent);
          const { exports, __esModule } = mod;
          const exp = __esModule ? exports : (mod._ext_exports ??= { ...exports, default: exports });

          for (const exportName of Object.keys(exp)) {
            serverManifest[uid] = {
              id: uid,
              name: exportName,
              chunks: [],
            };
          }
        } catch (err) {
          console.log(err);
        }
      }
    }

    if (componentManifestDelete) {
      for (const fileName of componentManifestDelete) {
        const client = clientManifest[fileName];
        for (const exportName in client) {
          delete serverManifest[`${fileName}#${exportName}`];
        }
        delete clientManifest[fileName];
      }
    }
  },
};
