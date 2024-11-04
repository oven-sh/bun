// This API is under heavy development. See #bake in the Bun Discord for more info.
// Definitions that are commented out are planned but not implemented.
//
// To use, add a TypeScript reference comment mentioning this file:
// /// <reference path="/path/to/bun/src/bake/bake.d.ts" />

declare module "bun" {
  type Awaitable<T> = T | Promise<T>;

  declare namespace Bake {
    interface Options {
      /** Will be replaced by fileSystemRouters */
      routes: {}[];

      /**
       * Bun provides built-in support for using React as a framework by passing
       * 'react' as the framework name. Otherwise, frameworks are config objects.
       *
       * External dependencies:
       * ```
       * bun i react@experimental react-dom@experimental react-server-dom-webpack@experimental react-refresh@experimental
       * ```
       */
      framework: Framework | "react";
      // Note: To contribute to 'bun-framework-react', it can be run from this file:
      // https://github.com/oven-sh/bun/blob/main/src/bake/bun-framework-react/index.ts

      /**
       * A subset of the options from Bun.build can be configured. Keep in mind,
       * your framework may set different defaults.
       *
       * @default {}
       */
      bundlerOptions?: BundlerOptions | undefined;
    }

    /** Bake only allows a subset of options from `Bun.build` */
    type BuildConfigSubset = Pick<
      BuildConfig,
      "conditions" | "plugins" | "define" | "loader" | "ignoreDCEAnnotations" | "drop"
      // - format is not allowed because it is set to an internal "hmr" format
      // - entrypoints/outfile/outdir doesnt make sense to set
      // - disabling sourcemap is not allowed because it makes code impossible to debug
      // - enabling minifyIdentifiers in dev is not allowed because some generated code does not support it
      // - publicPath is set elsewhere (TODO:)
      // - emitDCEAnnotations is not useful
      // - banner and footer do not make sense in these multi-file builds
      // - experimentalCss cannot be disabled
      // - disabling external would make it exclude imported files.

      // TODO: jsx customization
      // TODO: chunk naming
    >;

    type BundlerOptions = BuildConfigSubset & {
      /** Customize the build options of the client-side build */
      client?: BuildConfigSubset;
      /** Customize the build options of the server build */
      server?: BuildConfigSubset;
      /** Customize the build options of the separated SSR graph */
      ssr?: BuildConfigSubset;
    };

    /**
     * A "Framework" in our eyes is simply a set of bundler options that a
     * framework author would set in order to integrate framework code with the
     * application. Many of the configuration options are paths, which are
     * resolved as import specifiers.
     */
    interface Framework {
      /**
       * Customize the bundler options. Plugins in this array are merged
       * with any plugins the user has.
       * @default {}
       */
      bundlerOptions?: BundlerOptions | undefined;
      /**
       * The translation of files to routes is unopinionated and left
       * to framework authors. This interface allows most flexibility
       * between the already established conventions while allowing
       * new ideas to be explored too.
       * @default []
       */
      fileSystemRouterTypes?: FrameworkFileSystemRouterType[] ;
      /**
       * A list of directories that should be served statically. If the directory
       * does not exist in the user's project, it is ignored.
       *
       * Example: 'public' or 'static'
       *
       * Different frameworks have different opinions, some use 'static', some
       * use 'public'.
       * @default []
       */
      staticRouters?: Array<StaticRouter> | undefined;
      /**
       * Add extra modules. This can be used to, for example, replace `react`
       * with a different resolution.
       *
       * Internally, Bun's `react-server-components` framework uses this to
       * embed its files in the `bun` binary.
       * @default {}
       */
      builtInModules?: BuiltInModule[] | undefined;
      /**
       * Bun offers integration for React's Server Components with an
       * interface that is generic enough to adapt to any framework.
       * @default undefined
       */
      serverComponents?: ServerComponentsOptions | undefined;
      /**
       * While it is unlikely that Fast Refresh is useful outside of
       * React, it can be enabled regardless.
       * @default false
       */
      reactFastRefresh?: boolean | ReactFastRefreshOptions | undefined;

      // /**
      //  * Called after the list of routes is updated. This can be used to
      //  * implement framework-specific features like `.d.ts` generation:
      //  * https://nextjs.org/docs/app/building-your-application/configuring/typescript#statically-typed-links
      //  */
      // onRouteListUpdate?: (routes: OnRouteListUpdateItem) => void;
    }

    type BuiltInModule = { import: string; code: string } | { import: string; path: string };

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
       *     import * as ReactDOM from 'react-dom/server' with { bunBakeGraph: 'ssr' };
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
       * @default "registerClientReference"
       */
      serverRegisterClientReferenceExport?: string | undefined;
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

    type ReactRefreshSignatureFunction = () =>
      | void
      | ((func: Function, hash: string, force?: bool, customHooks?: () => Function[]) => void);

    /** This API is similar, but unrelated to `Bun.FileSystemRouter`  */
    interface FrameworkFileSystemRouterType {
      /**
       * Relative to project root. For example: `src/pages`.
       */
      root: string;
      /**
       * The prefix to serve this directory on.
       * @default "/"
       */
      prefix?: string | undefined;
      /**
       * This file is the entrypoint of the server application. This module
       * must `export default` a fetch function, which takes a request and the
       * bundled route module, and returns a response. See `ServerEntryPoint`
       *
       * When `serverComponents` is configured, this can access the component
       * manifest using the special 'bun:bake/server' import:
       *
       *     import { serverManifest } from 'bun:bake/server'
       */
      serverEntryPoint: ImportSource<ServerEntryPoint>;
      /**
       * This file is the true entrypoint of the client application. If null,
       * a client will not be bundled, and the route will not receive bundling
       * for client-side interactivity.
       */
      clientEntryPoint?: ImportSource<ClientEntryPoint> | null;
      /** Do not traverse into directories and files that start with an `_` */
      ignoreUnderscores?: boolean;
      /**
       * @default ["node_modules", ".git"]
       */
      ignoreDirs?: string[];
      /**
       * Extensions to match on.
       * '*' - any extension
       */
      extensions: string[] | "*";
      /**
       * 'nextjs-app' builds routes out of directories with `page.tsx` and `layout.tsx`
       * 'nextjs-pages' builds routes out of any `.tsx` file and layouts with `_layout.tsx`. Component routes are marked as "use client".
       *
       * Eventually, an API will be added to add custom styles.
       */
      style: "nextjs-app" | "nextjs-pages" | CustomFileSystemRouterFunction;
    }

    type StaticRouter =
      /** Alias for { source: ..., prefix: "/" } */
      | string
      | {
          /** The source directory to observe. */
          source: string;
          /** The prefix to serve this directory on. */
          prefix: string;
        };

    /**
     * Bun will call this function for every found file. This
     * function classifies each file's role in the file system routing.
     */
    type CustomFileSystemRouterFunction = (candidatePath: string) => CustomFileSystemRouterResult;

    type CustomFileSystemRouterResult =
      /** Skip this file */
      | undefined
      | null
      /**
       * Use this file as a route. Routes may nest, where a framework
       * can use parent routes to implement layouts.
       *
       * TODO: API design for sanely linking routes to their parent.
       */
      | {
          type: "route";
          pattern: RoutePattern;
          navigatable: boolean;
        };

    /**
     * Will be resolved from the point of view of the framework user's project root
     * Examples: `react-dom`, `./entry_point.tsx`, `/absolute/path.js`
     */
    type ImportSource<T = unknown> = string;

    interface ServerEntryPoint {
      /**
       * Bun passes the route's module as an opaque argument `routeModule`. The
       * framework implementation decides and enforces the shape of the module.
       *
       * A common pattern would be to enforce the object is
       * `{ default: ReactComponent }`
       */
      render: (request: Request, routeModule: unknown, routeMetadata: RouteMetadata) => Awaitable<Response>;
      /**
       * Static rendering does not take a response in, and can generate
       * multiple output files. Note that `import.meta.env.STATIC` will
       * be inlined to true during a static build.
       */
      prerender: (routeModule: unknown, routeMetadata: RouteMetadata) => Awaitable<PrerenderResult | null>;
    }

    interface PrerenderResult {
      files?: Record<string, Blob | NodeJS.TypedArray | ArrayBufferLike | string | Bun.BlobPart[]>;
    }

    interface ClientEntryPoint {
      /**
       * Called when server-side code is changed. This can be used to fetch a
       * non-html version of the updated page to perform a faster reload. If
       * this function does not exist or throws, the client will perform a
       * hard reload.
       *
       * Tree-shaken away in production builds.
       */
      onServerSideReload?: () => Promise<void> | void;
    }

    /**
     * This object and it's children may be re-used between invocations, so it
     * is not safe to mutate it at all.
     */
    interface RouteMetadata {
      // readonly routeModule: unknown;
      // readonly layouts: ReadonlyArray<LayoutMetadata>;
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

  interface GenericServeOptions {
    /** Add a fullstack web app to this server using Bun Bake */
    app?: Bake.Options | undefined;
  }
}

declare module "bun:bake/server" {
  // NOTE: The format of these manifests will likely be customizable in the future.

  /**
   * This follows the requirements for React's Server Components manifest, which
   * is a mapping of component IDs to the client-side file it is exported in.
   * The specifiers from here are to be imported in the client.
   *
   * To perform SSR with client components, see `clientManifest`
   */
  declare const serverManifest: ReactServerManifest;
  /**
   * Entries in this manifest map from client-side files to their respective SSR
   * bundles. They can be loaded by `await import()` or `require()`.
   */
  declare const clientManifest: ReactClientManifest;

  /** (insert teaser trailer) */
  declare const actionManifest: never;

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

  declare interface ReactClientManifest {
    /** ReactServerManifest[...].id */
    [id: string]: {
      /** ReactServerManifest[...].name */
      [name: string]: {
        /** Valid specifier to import */
        specifier: string;
        /** Export name */
        name: string;
      };
    };
  }
}

declare module "bun:bake/client" {
  /**
   * Due to the current implementation of the Dev Server, it must be informed of
   * client-side routing so it can load client components. This is not necessary
   * in production, and calling this in that situation will fail to compile.
   */
  declare function bundleRouteForDevelopment(href: string, options?: { signal?: AbortSignal }): Promise<void>;
}
