// This file is the entrypoint to the hot-module-reloading runtime.
// On the server, communication is established with `server_exports`.
import type { Bake } from "bun";
import "./debug";
import { loadExports, replaceModules, serverManifest, ssrManifest } from "./hmr-module";
// import { AsyncLocalStorage } from "node:async_hooks";
const { AsyncLocalStorage } = require("node:async_hooks");

if (typeof IS_BUN_DEVELOPMENT !== "boolean") {
  throw new Error("DCE is configured incorrectly");
}

export type RequestContext = {
  responseOptions: ResponseInit;
  streaming: boolean;
  streamingStarted?: boolean;
  renderAbort?: (path: string, params: Record<string, any> | null) => never;
};

// Create the AsyncLocalStorage instance for propagating response options
const responseOptionsALS = new AsyncLocalStorage();
let asyncLocalStorageWasSet = false;

interface Exports {
  handleRequest: (
    req: Request,
    routerTypeMain: Id,
    routeModules: Id[],
    clientEntryUrl: string,
    styles: string[],
    params: Record<string, string> | null,
    setAsyncLocalStorage: Function,
    bundleNewRoute: (req: Request, path: string) => [number, Promise<void> | undefined],
    newRouteParams: (
      req: Request,
      routeBundleIndex: number,
      url: string,
    ) => {
      routerTypeMain: Id;
      routeModules: Id[];
      clientEntryUrl: string;
      styles: string[];
      params: Record<string, string> | null;
    },
  ) => any;
  registerUpdate: (
    modules: any,
    componentManifestAdd: null | string[],
    componentManifestDelete: null | string[],
  ) => void;
}

declare let server_exports: Exports;
server_exports = {
  async handleRequest(
    req,
    routerTypeMain,
    routeModules,
    clientEntryUrl,
    styles,
    params,
    setAsyncLocalStorage,
    bundleNewRoute,
    newRouteParams,
  ) {
    if (!asyncLocalStorageWasSet) {
      asyncLocalStorageWasSet = true;
      setAsyncLocalStorage(responseOptionsALS);
    }

    while (true) {
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

      let requestWithCookies = req;

      let storeValue: RequestContext = {
        responseOptions: {},
        streaming: pageModule.streaming ?? false,
      };

      try {
        // Run the renderer inside the AsyncLocalStorage context
        // This allows Response constructors to access the stored options
        const response = await responseOptionsALS.run(storeValue, async () => {
          return await serverRenderer(
            requestWithCookies,
            {
              styles: styles,
              modules: [clientEntryUrl],
              layouts,
              pageModule,
              modulepreload: [],
              params,
              // Pass request in metadata when mode is 'ssr'
              request: pageModule.mode === "ssr" ? requestWithCookies : undefined,
            },
            responseOptionsALS,
          );
        });

        if (!(response instanceof Response)) {
          throw $ERR_SSR_RESPONSE_EXPECTED(`Server-side request handler was expected to return a Response object.`);
        }

        return response;
      } catch (error) {
        // For `Response.render(...)`/`Response.redirect(...)` we throw the
        // response to stop React from rendering
        if (error instanceof Response) {
          const resp = error;

          // Handle `Response.render(...)`
          if (resp.status !== 302) {
            const newUrl = resp.headers.get("location");
            if (!newUrl) {
              throw new Error("Response.render(...) was expected to have a Location header");
            }

            const [routeBundleIndex, promise] = bundleNewRoute(req, newUrl);
            if (promise) await promise;
            if (req.signal.aborted) return new Response("");

            const newArgs = newRouteParams(req, routeBundleIndex, newUrl);
            routerTypeMain = newArgs.routerTypeMain;
            routeModules = newArgs.routeModules;
            clientEntryUrl = newArgs.clientEntryUrl;
            styles = newArgs.styles;
            params = newArgs.params;

            continue;
          }

          // `Response.redirect(...)` or others, just return it
          return resp;
        }

        throw error;
      }
    }
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
