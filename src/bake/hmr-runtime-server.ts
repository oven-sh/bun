// This file is the entrypoint to the hot-module-reloading runtime.
// On the server, communication is established with `server_exports`.
import type { Bake } from "bun";
import "./debug";
import { loadExports, replaceModules, serverManifest, ssrManifest } from "./hmr-module";

if (typeof IS_BUN_DEVELOPMENT !== "boolean") {
  throw new Error("DCE is configured incorrectly");
}

// Dynamic import of AsyncLocalStorage to work with bundling
// The require is wrapped in eval to prevent bundler from trying to resolve it at bundle time
const AsyncLocalStorage = eval('require("node:async_hooks").AsyncLocalStorage');

// Create the AsyncLocalStorage instance for propagating response options
const responseOptionsALS = new AsyncLocalStorage();

// Store reference to the AsyncLocalStorage in the VM
// This will be accessed from Zig code
const setDevServerAsyncLocalStorage = $newZigFunction("bun.js/VirtualMachine.zig", "setDevServerAsyncLocalStorage", 2);
const getDevServerAsyncLocalStorage = $newZigFunction("bun.js/VirtualMachine.zig", "getDevServerAsyncLocalStorage", 1);

// Set the AsyncLocalStorage instance in the VM
setDevServerAsyncLocalStorage(responseOptionsALS);

interface Exports {
  handleRequest: (
    req: Request,
    routerTypeMain: Id,
    routeModules: Id[],
    clientEntryUrl: string,
    styles: string[],
    params: Record<string, string> | null,
  ) => any;
  registerUpdate: (
    modules: any,
    componentManifestAdd: null | string[],
    componentManifestDelete: null | string[],
  ) => void;
}

declare let server_exports: Exports;
server_exports = {
  async handleRequest(req, routerTypeMain, routeModules, clientEntryUrl, styles, params) {
    if (IS_BUN_DEVELOPMENT && process.env.BUN_DEBUG_BAKE_JS) {
      console.log("handleRequest", {
        routeModules,
        clientEntryUrl,
        styles,
        params,
      });
    }

    const exports = await loadExports<Bake.ServerEntryPoint>(routerTypeMain);

    const serverRenderer = exports.render;

    if (!serverRenderer) {
      throw new Error('Framework server entrypoint is missing a "render" export.');
    }
    if (typeof serverRenderer !== "function") {
      throw new Error('Framework server entrypoint\'s "render" export is not a function.');
    }

    const [pageModule, ...layouts] = await Promise.all(routeModules.map(loadExports));
    
    // Run the renderer inside the AsyncLocalStorage context
    // This allows Response constructors to access the stored options
    const response = await responseOptionsALS.run({}, async () => {
      return await serverRenderer(req, {
        styles: styles,
        modules: [clientEntryUrl],
        layouts,
        pageModule,
        modulepreload: [],
        params,
      }, responseOptionsALS);
    });

    if (!(response instanceof Response)) {
      throw new Error(`Server-side request handler was expected to return a Response object.`);
    }

    return response;
  },
  async registerUpdate(modules, componentManifestAdd, componentManifestDelete) {
    replaceModules(modules);

    if (componentManifestAdd) {
      for (const uid of componentManifestAdd) {
        try {
          const exports = await loadExports<{}>(uid);

          const client = {};
          for (const exportName of Object.keys(exports)) {
            serverManifest[uid + "#" + exportName] = {
              id: uid,
              name: exportName,
              chunks: [],
            };
            client[exportName] = {
              specifier: "ssr:" + uid,
              name: exportName,
            };
          }
          ssrManifest[uid] = client;
        } catch (err) {
          console.log(err);
        }
      }
    }

    if (componentManifestDelete) {
      for (const fileName of componentManifestDelete) {
        const client = ssrManifest[fileName];
        for (const exportName in client) {
          delete serverManifest[`${fileName}#${exportName}`];
        }
        delete ssrManifest[fileName];
      }
    }
  },
} satisfies Exports;
