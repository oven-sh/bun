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

interface Exports {
  handleRequest: (
    req: Request,
    routerTypeMain: string,
    routeModules: string[],
    clientEntryUrl: string,
    styles: string[],
    params: Record<string, string> | null,
    setAsyncLocalStorage: Function,
  ) => Promise<Response>;
}

declare let server_exports: Exports;

server_exports = {
  async handleRequest(req, routerTypeMain, routeModules, clientEntryUrl, styles, params, setAsyncLocalStorage) {
    // Set up AsyncLocalStorage if not already done
    if (!asyncLocalStorageWasSet) {
      asyncLocalStorageWasSet = true;
      setAsyncLocalStorage(responseOptionsALS);
    }
    // Load the server entrypoint module
    const serverEntryPoint = await import(routerTypeMain);

    const serverRenderer = serverEntryPoint.render;

    if (!serverRenderer) {
      throw new Error('Framework server entrypoint is missing a "render" export.');
    }
    if (typeof serverRenderer !== "function") {
      throw new Error('Framework server entrypoint\'s "render" export is not a function.');
    }

    // Load all route modules (page and layouts)
    const [pageModule, ...layouts] = await Promise.all(routeModules.map(modulePath => import(modulePath)));

    // Set up the request context for AsyncLocalStorage
    let storeValue: RequestContext = {
      responseOptions: {},
      streaming: pageModule.streaming ?? false,
    };

    try {
      // Run the renderer inside the AsyncLocalStorage context
      // This allows Response constructors to access the stored options
      const response = await responseOptionsALS.run(storeValue, async () => {
        return await serverRenderer(
          req,
          {
            styles,
            modules: [clientEntryUrl],
            layouts,
            pageModule,
            modulepreload: [],
            params,
            // Pass request in metadata when mode is 'ssr'
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
        return error;
      }

      // Re-throw other errors
      throw error;
    }
  },
};
