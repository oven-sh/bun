declare module "bun" {
  declare function wipDevServerExpectHugeBreakingChanges(options: Bake.Options): never;

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
      builtInModules: Record<string, BuiltInModule>;
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
       * When set `true`, when bundling "use client" components for SSR, these
       * files will be placed in a separate bundling graph where `conditions` does
       * not include `react-server`.
       *
       * The built in framework config for React enables this flag so that server
       * components and client components, utilize their own versions of React,
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
    }

    /** Customize the React Fast Refresh transform. */
    interface ReactFastRefreshOptions {
      /** @default "react-refresh/runtime" */
      importSource: ImportSource | undefined;
    }

    /// Will be resolved from the point of view of the framework user's project root
    /// Examples: `react-dom`, `./entry_point.tsx`, `/absolute/path.js`
    type ImportSource = string;

    interface ServerEntryPoint {
      /**
       * The framework implementation decides and enforces the shape
       * of the route module. Bun passes it as an opaque value.
       */
      default: (request: Request, routeModule: unknown, routeMetadata: RouteMetadata) => Response;
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

    interface RouteMetadata {
      /** A list of css files that the route will need to be styled */
      styles: string[];
      /** A list of js files that the route will need to be interactive */
      scripts: string[];
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
