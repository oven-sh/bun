// This file is the entrypoint to the production SSR runtime.
// It handles server-side rendering for production builds.
import type { Bake } from "bun";
const { AsyncLocalStorage } = require("node:async_hooks");

// In production, we don't need HMR-related imports
// We'll load modules directly from the bundled output

export type RequestContext = {
  responseOptions: ResponseInit;
  streaming: boolean;
  streamingStarted?: boolean;
  renderAbort?: (path: string, params: Record<string, any> | null) => never;
};

// Create the AsyncLocalStorage instance for propagating response options
const responseOptionsALS = new AsyncLocalStorage();
// let responseOptionsALS = {
//   run: async (storeValue, fn) => {
//     return await fn();
//   },
// };
let asyncLocalStorageWasSet = false;

type Module = unknown;

type RouteArgs = {
  serverEntrypoint: string;
  routeModules: string[];
  clientEntryUrl: string;
  styles: string[];
};

/**
 * A type representing all the data needed to render this route.
 *
 * Note that these fields are actually undefined when this object is
 * uninitialized
 */
type RouteInfo = {
  /**
   * The server entrypoint which contains the module to render the page.
   */
  serverEntrypoint: Module & Bake.ServerEntryPoint;
  routeModules: Module[];
  clientEntryUrl: string;
  styles: string[];
  /**
   * A function to fetch the needed to data to initialize this RouteInfo object
   */
  dataForInitialization(req: Request, routeIndex: number, routerTypeIndex: number): RouteArgs;
  initializing: Promise<unknown> | undefined;
};

interface Exports {
  handleRequest: (
    req: Request,
    routeIndex: number,
    routerTypeIndex: number,
    routeInfo: RouteInfo,
    params: Record<string, string> | null,
    newRouteParams: (
      req: Request,
      url: string,
    ) =>
      | [routeIndex: number, routerTypeIndex: number, routeInfo: RouteInfo, params: Record<string, string> | null]
      | Blob,
    setAsyncLocalStorage: Function,
  ) => Promise<Response>;
}

declare let server_exports: Exports;

server_exports = {
  async handleRequest(req, routeIndex, routerTypeIndex, routeInfo, params, newRouteParams, setAsyncLocalStorage) {
    // Set up AsyncLocalStorage if not already done
    if (!asyncLocalStorageWasSet) {
      asyncLocalStorageWasSet = true;
      setAsyncLocalStorage(responseOptionsALS);
    }

    while (true) {
      if (routeInfo.initializing) {
        await routeInfo.initializing;
        routeInfo.initializing = undefined;
      }

      if (!routeInfo.serverEntrypoint) {
        const args = routeInfo.dataForInitialization(req, routeIndex, routerTypeIndex);
        const { promise, resolve, reject } = Promise.withResolvers();
        routeInfo.initializing = promise;

        try {
          routeInfo.serverEntrypoint = await import(args.serverEntrypoint);
          routeInfo.routeModules = await Promise.all(args.routeModules.map(modulePath => import(modulePath)));
          routeInfo.clientEntryUrl = args.clientEntryUrl;
          routeInfo.styles = args.styles;
          resolve();
        } catch (error) {
          reject(error);
          throw error;
        } finally {
          routeInfo.initializing = undefined;
        }

        if (!routeInfo.serverEntrypoint.render) {
          throw new Error('Framework server entrypoint is missing a "render" export.');
        }
        if (typeof routeInfo.serverEntrypoint.render !== "function") {
          throw new Error('Framework server entrypoint\'s "render" export is not a function.');
        }
      }

      const serverRenderer = routeInfo.serverEntrypoint.render;

      // Load all route modules (page and layouts)
      const [pageModule, ...layouts] = routeInfo.routeModules;

      // Set up the request context for AsyncLocalStorage
      let storeValue: RequestContext = {
        responseOptions: {},
        streaming: (pageModule as { streaming?: boolean }).streaming ?? false,
      };

      try {
        // Run the renderer inside the AsyncLocalStorage context
        // This allows Response constructors to access the stored options
        const response = await responseOptionsALS.run(storeValue, async () => {
          return await serverRenderer(
            req,
            {
              styles: routeInfo.styles,
              modules: [routeInfo.clientEntryUrl],
              layouts,
              pageModule,
              modulepreload: [],
              params,
              request: pageModule.mode === "ssr" ? req : undefined,
            },
            responseOptionsALS,
          );
        });

        if (!(response instanceof Response)) {
          throw new Error("Server-side request handler was expected to return a Response object.");
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

            const result = newRouteParams(req, newUrl);
            if (result instanceof Blob) {
              console.log("Returning a blob", result);
              return new Response(result);
            }
            const [newRouteIndex, newRouterTypeIndex, newRouteInfo, newParams] = result;

            routeIndex = newRouteIndex;
            routerTypeIndex = newRouterTypeIndex;
            routeInfo = newRouteInfo;
            params = newParams;

            continue;
          }

          // `Response.redirect(...)` or others, just return it
          return resp;
        }

        // Re-throw other errors
        throw error;
      }
    }
  },
};
