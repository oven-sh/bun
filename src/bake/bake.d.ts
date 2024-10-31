declare module "bun" {
  declare function wipDevServerExpectHugeBreakingChanges(options: Bake.Options): never;

  type Awaitable<T> = T | Promise<T>;

  declare namespace Bake {
    interface Options {
      /**
       * Bun provides built-in support for using React as a framework by
       * passing 'react-server-components' as the framework name.
       *
       * Has external dependencies:
       * ```
       * bun i react@experimental react-dom@experimental react-server-dom-webpack@experimental react-refresh@experimental
       * ```
       */
      framework: Framework | "react-server-components";

      /**
       * Route patterns must be statically known.
       * TODO: Static at dev-server start is bad and this API must be revisited
       */
      routes: Record<RoutePattern, RouteOptions>;

      // TODO: many other options
    }

    /**
     * A "Framework" in our eyes is simply a set of bundler options that a
     * framework author would set in order to integrate framework code with the
     * application. Many of the configuration options are paths, which are
     * resolved as import specifiers. The first thing the bundler does is
     * ensure that all import specifiers are fully resolved.
     */
    interface Framework {
      /**
       * This file is the true entrypoint of the server application. This module
       * must `export default` a fetch function, which takes a request and the
       * bundled route module, and returns a response. See `ServerEntryPoint`
       *
       * When `serverComponents` is configured, this can access the component
       * manifest using the special 'bun:bake/server' import:
       *
       *     import { serverManifest } from 'bun:bake/server'
       */
      serverEntryPoint: ImportSource;
      /**
       * This file is the true entrypoint of the client application.
       *
       * When `serverComponents` is configured, this can access the component
       * manifest using the special 'bun:bake/client' import:
       *
       *     import { clientManifest } from 'bun:bake/client'
       */
      clientEntryPoint: ImportSource;
      /**
       * Add extra modules
       */
      builtInModules?: Record<string, BuiltInModule>;
      /**
       * Bun offers integration for React's Server Components with an
       * interface that is generic enough to adapt to any framework.
       */
      serverComponents?: ServerComponentsOptions | undefined;
      /**
       * While it is unlikely that Fast Refresh is useful outside of
       * React, it can be enabled regardless.
       */
      reactFastRefresh?: ReactFastRefreshOptions | true | undefined;
    }

    type BuiltInModule = { code: string } | { path: string };

    /**
     * A high-level overview of what server components means exists
     * in the React Docs: https://react.dev/reference/rsc/server-components
     *
     * When enabled, files with "use server" and "use client" directives will get
     * special processing according to this object, in combination with the
     * framework-specified entry points for server rendering and browser
     * interactivity.
     */
    interface ServerComponentsOptions {
      /**
       * If you are unsure what to set this to for a custom server components
       * framework, choose 'false'.
       *
       * When set `true`, bundling "use client" components for SSR will be
       * placed in a separate bundling graph without the `react-server`
       * condition. All imports that stem from here get re-bundled for
       * this second graph, regardless if they actually differ via this
       * condition.
       *
       * The built in framework config for React enables this flag so that server
       * components and client components utilize their own versions of React,
       * despite running in the same process. This facilitates different aspects
       * of the server and client react runtimes, such as `async` components only
       * being available on the server.
       *
       * To cross from the server graph to the SSR graph, use the bun_bake_graph
       * import attribute:
       *
       *     import * as ReactDOM from 'react-dom/server' with { bun_bake_graph: 'ssr' };
       *
       * Since these models are so subtley different, there is no default value
       * provided for this.
       */
      separateSSRGraph: boolean;
      /** Server components runtime for the server */
      serverRuntimeImportSource: ImportSource;
      /**
       * When server code imports client code, a stub module is generated,
       * where every export calls this export from `serverRuntimeImportSource`.
       * This is used to implement client components on the server.
       *
       * The call is given three arguments:
       *
       *     export const ClientComp = registerClientReference(
       *         // A function which may be passed through, it throws an error
       *         function () { throw new Error('Cannot call client-component on the server') },
       *
       *         // The file path. In production, these use hashed strings for
       *         // compactness and code privacy.
       *         "src/components/Client.tsx",
       *
       *         // The instance id. This is not guaranteed to match the export
       *         // name the user has given.
       *         "ClientComp",
       *     );
       *
       * Additionally, the bundler will assemble a component manifest to be used
       * during rendering.
       */
      serverRegisterClientReferenceExport: string | undefined;
      // /**
      //  * Allow creating client components inside of server-side files by using "use client"
      //  * as the first line of a function declaration. This is useful for small one-off
      //  * interactive components. This is behind a flag because it is not a feature of
      //  * React or Next.js, but rather is implemented because it is possible to.
      //  * 
      //  * The client versions of these are tree-shaked extremely aggressively: anything
      //  * not referenced by the function body will be removed entirely.
      //  */
      // allowAnonymousClientComponents: boolean;
    }

    /** Customize the React Fast Refresh transform. */
    interface ReactFastRefreshOptions {
      /** 
       * This import has four exports, mirroring "react-refresh/runtime":
       * 
       * `injectIntoGlobalHook(window): void`
       * Called on first startup, before the user entrypoint.
       * 
       * `register(component, uniqueId: string): void`
       * Called on every function that starts with an uppercase letter. These
       * may or may not be components, but they are always functions.
       * 
       * `createSignatureFunctionForTransform(): ReactRefreshSignatureFunction`
       * TODO: document. A passing no-op for this api is `return () => {}`
       * 
       * @default "react-refresh/runtime"
       */
      importSource: ImportSource | undefined;
    }

    type ReactRefreshSignatureFunction = () => void | ((func: Function, hash: string, force?: bool, customHooks?: () => Function[]) => void);

    /// Will be resolved from the point of view of the framework user's project root
    /// Examples: `react-dom`, `./entry_point.tsx`, `/absolute/path.js`
    type ImportSource = string;

    interface ServerEntryPoint {
      /**
       * The framework implementation decides and enforces the shape
       * of the route module. Bun passes it as an opaque value.
       */
      default: (request: Request, routeModule: unknown, routeMetadata: RouteMetadata) => Awaitable<Response>;
      /**
       * Static rendering does not take a response in, and can generate
       * multiple output files. Note that `import.meta.env.STATIC` will
       * be inlined to true during a static build.
       */
      staticRender: (routeModule: unknown, routeMetadata: RouteMetadata) => Awaitable<Record<string, Blob | ArrayBuffer>>;
    }

    interface ClientEntryPoint {
      /**
       * Called when server-side code is changed. This can be used to fetch a
       * non-html version of the updated page to perform a faster reload.
       *
       * Tree-shaken away in production builds.
       */
      onServerSideReload?: () => void;
    }

    /**
     * This object and it's children may be re-used between invocations, so it
     * is not safe to mutate it at all.
     */
    interface RouteMetadata {
      /**
       * A list of js files that the route will need to be interactive.
       */
      readonly scripts: ReadonlyArray<string>;
      /**
       * A list of css files that the route will need to be styled.
       */
      readonly styles: ReadonlyArray<string>;
      /**
       * Can be used by the framework to mention the route file. Only provided in
       * development mode to prevent leaking these details into production
       * builds.
       */
      devRoutePath?: string;
    }
  }

  // declare class Bake {
  //   constructor(options: Bake.Options);
  // }
}

declare module "bun:bake/server" {
  // NOTE: The format of these manifests will likely be customizable in the future.

  /**
   * Entries in this manifest can be loaded by using dynamic `await import()` or
   * `require`. The bundler always ensures that all modules are ready on the server.
   */
  declare const clientManifest: ReactClientManifest;
  /**
   * This follows the requirements for React's Server Components manifest, which
   * does not actually include usable module specifiers. Calling `import()` on
   * these specifiers wont work, but they will work client-side. Use
   * `clientManifest` on the server for SSR.
   */
  declare const serverManifest: ReactServerManifest;

  /** (insert teaser trailer) */
  declare const actionManifest: never;
}

declare module "bun:bake/client" {
  /**
   * Entries in this manifest can be loaded by using dynamic `await import()` or
   * `require`. The bundler currently ensures that all modules are ready.
   */
  declare const clientManifest: ReactClientManifest;
}

declare interface ReactClientManifest {
  [id: string]: {
    [name: string]: {
      /** Valid specifier to import */
      specifier: string;
      /** Export name */
      name: string;
    };
  };
}

declare interface ReactServerManifest {
  /**
   * Concatenation of the component file ID and the instance id with '#'
   * Example: 'components/Navbar.tsx#default' (dev) or 'l2#a' (prod/minified)
   *
   * The component file ID and the instance id are both passed to `registerClientReference`
   */
  [combinedComponentId: string]: {
    /**
     * The `id` in ReactClientManifest.
     * Correlates but is not required to be the filename
     */
    id: string;
    /**
     * The `name` in ReactServerManifest
     * Correlates but is not required to be the export name
     */
    name: string;
    /** Currently not implemented; always an empty array */
    chunks: [];
  };
}
