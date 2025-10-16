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

type Module = unknown;

type RouteArgs = [serverEntrypoint: string, routeModules: string[], clientEntryUrl: string, styles: string[]];

type UninitializedRouteInfo = [] | [undefined, undefined, undefined, undefined, Promise<unknown> | undefined];

type RouteInfo = [
  /**
   * The server entrypoint which contains the module to render the page.
   */
  serverEntrypoint: Module & Bake.ServerEntryPoint,
  routeModules: Module[],
  clientEntryUrl: string,
  styles: string[],
  initializing: Promise<unknown> | undefined,
];

export namespace RouteInfo {
  export function isUninitialized(
    uninitializedRouteInfo: UninitializedRouteInfo | RouteInfo,
  ): uninitializedRouteInfo is UninitializedRouteInfo {
    return uninitializedRouteInfo[0] === undefined;
  }

  export const serverEntrypoint: 0 = 0;
  export const routeModules: 1 = 1;
  export const clientEntryUrl: 2 = 2;
  export const styles: 3 = 3;
  export const initializing: 4 = 4;
}

let routeInfos: Array<UninitializedRouteInfo | RouteInfo> = [];

interface Exports {
  initialize: (
    length: number,
    setAsyncLocalStorage: Function,
    dataForInitialization: (req: Request, routeIndex: number) => RouteArgs,
    newRouteParams: (req: Request, url: string) => [routeIndex: number, params: Record<string, string> | null],
  ) => void;
  handleRequest: (req: Request, routeIndex: number, params: Record<string, string> | null) => Promise<Response>;
}

let dataForInitialization: (req: Request, routeIndex: number) => RouteArgs = undefined as any;
let newRouteParams: (req: Request, url: string) => [routeIndex: number, params: Record<string, string> | null] | Blob =
  undefined as any;

declare let server_exports: Exports;

server_exports = {
  initialize(length, setAsyncLocalStorage, dataForInitializationFn, newRouteParamsFn) {
    routeInfos = new Array(length);
    for (let i = 0; i < length; i++) {
      routeInfos[i] = [];
    }
    setAsyncLocalStorage(responseOptionsALS);
    dataForInitialization = dataForInitializationFn;
    newRouteParams = newRouteParamsFn;
  },
  async handleRequest(req, routeIndex, params) {
    while (true) {
      let routeInfo = routeInfos[routeIndex];

      if (RouteInfo.isUninitialized(routeInfo)) {
        const [serverEntrypoint, routeModules, clientEntryUrl, styles] = dataForInitialization(req, routeIndex);
        const { promise, resolve, reject } = Promise.withResolvers();
        routeInfo = [undefined, undefined, undefined, undefined, promise];

        try {
          (routeInfo as unknown as RouteInfo) = [
            await import(serverEntrypoint),
            await Promise.all(routeModules.map(modulePath => import(modulePath))),
            clientEntryUrl,
            styles,
            undefined,
          ];
          resolve();
        } catch (error) {
          reject(error);
          throw error;
        } finally {
          routeInfo[RouteInfo.initializing] = undefined;
        }

        if (!(routeInfo as unknown as RouteInfo)[RouteInfo.serverEntrypoint]!.render) {
          throw new Error('Framework server entrypoint is missing a "render" export.');
        }
        if (typeof (routeInfo as unknown as RouteInfo)[RouteInfo.serverEntrypoint]!.render !== "function") {
          throw new Error('Framework server entrypoint\'s "render" export is not a function.');
        }
      }

      routeInfo = routeInfo as unknown as RouteInfo; // typescript

      if (routeInfo[RouteInfo.initializing]) {
        await routeInfo[RouteInfo.initializing];
        routeInfo[RouteInfo.initializing] = undefined;
      }

      const serverRenderer = routeInfo[RouteInfo.serverEntrypoint]!.render;

      // Load all route modules (page and layouts)
      const [pageModule, ...layouts] = routeInfo[RouteInfo.routeModules]!;

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
              styles: routeInfo[RouteInfo.styles]!,
              modules: [routeInfo[RouteInfo.clientEntryUrl]!],
              layouts,
              pageModule,
              modulepreload: [],
              params,
              request: (pageModule as { mode?: string }).mode === "ssr" ? req : undefined,
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
            // If the path points to an SSG route then we get a blob
            if (result instanceof Blob) {
              return new Response(result);
            }
            const [newRouteIndex, newParams] = result;

            routeIndex = newRouteIndex;
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
