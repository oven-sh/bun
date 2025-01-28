// This API is under heavy development. See #bake in the Bun Discord for more info.
// Definitions that are commented out are planned but not implemented.
//
// To use, add a TypeScript reference comment mentioning this file:
// /// <reference path="/path/to/bun/src/bake/bake.d.ts" />

declare module "bun" {
  type Awaitable<T> = T | Promise<T>;

  declare namespace Bake {
    interface Options {
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
       * A subset of the options from Bun.build can be configured. While the framework
       * can also set these options, this property overrides and merges with them.
       *
       * @default {}
       */
      bundlerOptions?: BundlerOptions | undefined;
      /**
       * These plugins are applied after `framework.plugins`
       */
      plugins?: BunPlugin[] | undefined;
    }

    /** Bake only allows a subset of options from `Bun.build` */
    type BuildConfigSubset = Pick<
      BuildConfig,
      "conditions" | "define" | "loader" | "ignoreDCEAnnotations" | "drop"
      // - format is not allowed because it is set to an internal "hmr" format
      // - entrypoints/outfile/outdir doesnt make sense to set
      // - disabling sourcemap is not allowed because it makes code impossible to debug
      // - enabling minifyIdentifiers in dev is not allowed because some generated code does not support it
      // - publicPath is set by the user (TODO: add options.publicPath)
      // - emitDCEAnnotations is not useful
      // - banner and footer do not make sense in these multi-file builds
      // - disabling external would make it exclude imported files.
      // - plugins is specified in the framework object, and currently merge between client and server.

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
      fileSystemRouterTypes?: FrameworkFileSystemRouterType[];
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
      /** Framework bundler plugins load before the user-provided ones. */
      plugins?: BunPlugin[];

      // /**
      //  * Called after the list of routes is updated. This can be used to
      //  * implement framework-specific features like `.d.ts` generation:
      //  * https://nextjs.org/docs/app/building-your-application/configuring/typescript#statically-typed-links
      //  */
      // onRouteListUpdate?: (routes: OnRouteListUpdateItem) => void;
    }

    /** Using `code` here will cause import resolution to happen from the root. */
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
       * When separateSSRGraph is enabled, the call looks like:
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
       * When separateSSRGraph is disabled, the call looks like:
       *
       *     export const ClientComp = registerClientReference(
       *         function () { ... original user implementation here ... },
       *
       *         // The file path of the client-side file to import in the browser.
       *         "/_bun/d41d8cd0.js",
       *
       *         // The export within the client-side file to load. This is
       *         // not guaranteed to match the export name the user has given.
       *        "ClientComp",
       *     );
       *
       * While subtle, the parameters in `separateSSRGraph` mode are opaque
       * strings that have to be looked up in the server manifest. While when
       * there isn't a separate SSR graph, the two parameters are the actual
       * URLs to load on the client; The manifest is not required for anything.
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
      clientEntryPoint?: ImportSource<ClientEntryPoint> | undefined;
      /**
       * Do not traverse into directories and files that start with an `_`.  Do
       * not index pages that start with an `_`. Does not prevent stuff like
       * `_layout.tsx` from being recognized.
       * @default false
       */
      ignoreUnderscores?: boolean;
      /**
       * @default ["node_modules", ".git"]
       */
      ignoreDirs?: string[];
      /**
       * Extensions to match on.
       * '*' - any extension
       * @default (set of all valid JavaScript/TypeScript extensions)
       */
      extensions?: string[] | "*";
      /**
       * 'nextjs-app' builds routes out of directories with `page.tsx` and `layout.tsx`
       * 'nextjs-pages' builds routes out of any `.tsx` file and layouts with `_layout.tsx`.
       *
       * Eventually, an API will be added to add custom styles.
       */
      style: "nextjs-pages" | "nextjs-app-ui" | "nextjs-app-routes" | CustomFileSystemRouterFunction;
      /**
       * If true, this will track route layouts and provide them as an array during SSR.
       * @default false
       */
      layouts?: boolean | undefined;
      // /**
      //  * If true, layouts act as navigation endpoints. This can be used to
      //  * implement Remix.run's router design, where `hello._index` and `hello`
      //  * are the same URL, but an allowed collision.
      //  *
      //  * @default false
      //  */
      // navigatableLayouts?: boolean | undefined;
      // /**
      //  * Controls how the route entry point is bundled with regards to server components:
      //  * - server-component: Default server components.
      //  * - client-boundary: As if "use client" was used on every route.
      //  * - disabled: As if server components was completely disabled.
      //  *
      //  * @default "server-component" if serverComponents is enabled, "disabled" otherwise
      //  */
      // serverComponentsMode?: "server-component" | "client-boundary" | "disabled";
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
       */
      | {
          /**
           * Route pattern can include `:param` for parameters, '*' for
           * catch-all, and '*?' for optional catch-all. Parameters must take
           * the full component of a path segment. Parameters cannot have
           * constraints at this moment.
           */
          pattern: string;
          type: "route" | "layout" | "extra";
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
      render: (request: Request, routeMetadata: RouteMetadata) => Awaitable<Response>;
      /**
       * Prerendering does not use a request, and is allowed to generate
       * multiple responses. This is used for static site generation, but not
       * not named `staticRender` as it is invoked during a dynamic build to
       * allow deterministic routes to be prerendered.
       *
       * Note that `import.meta.env.STATIC` will be inlined to true during
       * a static build.
       */
      prerender?: (routeMetadata: RouteMetadata) => Awaitable<PrerenderResult | null>;
      // TODO: prerenderWithoutProps (for partial prerendering)
      /**
       * For prerendering routes with dynamic parameters, such as `/blog/:slug`,
       * this will be called to get the list of parameters to prerender. This
       * allows static builds to render every page at build time.
       *
       * `getParams` may return an object with an array of pages. For example,
       * to generate two pages, `/blog/hello` and `/blog/world`:
       *
       *      return {
       *          pages: [{ slug: 'hello' }, { slug: 'world' }],
       *          exhaustive: true,
       *      }
       *
       * "exhaustive" tells Bun that the list is complete. If it is not, a
       * static site cannot be generated as it would otherwise be missing
       * routes. A non-exhaustive list can speed up build times by only
       * specifying a few important pages (such as 10 most recent), leaving
       * the rest to be generated on-demand at runtime.
       *
       * To stream results, `getParams` may return an async iterator, which
       * Bun will start rendering as more parameters are provided:
       *
       *     export async function* getParams(meta: Bake.ParamsMetadata) {
       *         yield { slug: await fetchSlug() };
       *         yield { slug: await fetchSlug() };
       *         return { exhaustive: false };
       *     }
       */
      getParams?: (paramsMetadata: ParamsMetadata) => Awaitable<GetParamIterator>;
      /**
       * When a dynamic build uses static assets, Bun can map content types in the
       * user's `Accept` header to the different static files.
       */
      contentTypeToStaticFile?: Record<string, string>;
    }

    type GetParamIterator =
      | AsyncIterable<Record<string, string>, GetParamsFinalOpts>
      | Iterable<Record<string, string>, GetParamsFinalOpts>
      | ({ pages: Array<Record<string, string>> } & GetParamsFinalOpts);

    type GetParamsFinalOpts = void | null | {
      /**
       * @default true
       */
      exhaustive?: boolean | undefined;
    };

    interface PrerenderResult {
      files?: Record<string, Blob | NodeJS.TypedArray | ArrayBufferLike | string | Bun.BlobPart[]>;
      // /**
      //  * For dynamic builds, `partialData` will be provided to `render` to allow
      //  * to implement Partial Pre-rendering, a technique where the a page shell
      //  * is rendered first, and the rendering is resumed. The bytes passed
      //  * here will be passed to the `render` function as `partialData`.
      //  */
      // partialData?: Uint8Array;

      // TODO: support incremental static regeneration + stale while revalidate here
      // cache: unknown;
    }

    interface ClientEntryPoint {
      // No exports
    }

    interface DevServerHookEntryPoint {
      default: (dev: DevServerHookAPI) => Awaitable<void>;
    }

    interface DevServerHookAPI {
      // TODO:
    }

    /**
     * This object and it's children may be re-used between invocations, so it
     * is not safe to mutate it at all.
     */
    interface RouteMetadata {
      /**
       * The loaded module of the page itself.
       */
      readonly pageModule: any;
      /**
       * The loaded module of all of the route layouts. The first one is the
       * inner-most, the last is the root layout.
       *
       * An example of converting the layout list into a nested JSX structure:
       *     const Page = meta.pageModule.default;
       *     let route = <Page />
       *     for (const layout of meta.layouts) {
       *       const Layout = layout.default;
       *       route = <Layout>{route}</Layout>;
       *     }
       */
      readonly layouts: ReadonlyArray<any>;
      /** Received route params. `null` if the route does not take params */
      readonly params: null | Record<string, string>;
      /**
       * A list of js files that the route will need to be interactive.
       */
      readonly modules: ReadonlyArray<string>;
      /**
       * A list of js files that should be preloaded.
       *
       *   <link rel="modulepreload" href="..." />
       */
      readonly modulepreload: ReadonlyArray<string>;
      /**
       * A list of css files that the route will need to be styled.
       */
      readonly styles: ReadonlyArray<string>;
    }

    /**
     * This object and it's children may be re-used between invocations, so it
     * is not safe to mutate it at all.
     */
    interface ParamsMetadata {
      readonly pageModule: any;
      readonly layouts: ReadonlyArray<any>;
    }
  }

  declare interface GenericServeOptions {
    /** Add a fullstack web app to this server using Bun Bake */
    app?: Bake.Options | undefined;
  }

  declare interface PluginBuilder {
    /**
     * Inject a module into the development server's runtime, to be loaded
     * before all other user code.
     */
    addPreload(...args: any): void;
  }

  declare interface OnLoadArgs {
    /**
     * When using server-components, the same bundle has both client and server
     * files; A single plugin can operate on files from both module graphs.
     * Outside of server-components, this will be "client" when the target is
     * set to "browser" and "server" otherwise.
     */
    side: "server" | "client";
  }
}

/** Available in server-side files only. */
declare module "bun:bake/server" {
  // NOTE: The format of these manifests will likely be customizable in the future.

  /**
   * This follows the requirements for React's Server Components manifest, which
   * is a mapping of component IDs to the client-side file it is exported in.
   * The specifiers from here are to be imported in the client.
   *
   * To perform SSR with client components, see `ssrManifest`
   */
  declare const serverManifest: ServerManifest;
  /**
   * Entries in this manifest map from client-side files to their respective SSR
   * bundles. They can be loaded by `await import()` or `require()`.
   */
  declare const ssrManifest: SSRManifest;

  /** (insert teaser trailer) */
  declare const actionManifest: never;

  declare interface ServerManifest {
    /**
     * Concatenation of the component file ID and the instance id with '#'
     * Example: 'components/Navbar.tsx#default' (dev) or 'l2#a' (prod/minified)
     *
     * The component file ID and the instance id are both passed to `registerClientReference`
     */
    [combinedComponentId: string]: ServerManifestEntry;
  }

  declare interface ServerManifestEntry {
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
  }

  declare interface SSRManifest {
    /** ServerManifest[...].id */
    [id: string]: {
      /** ServerManifest[...].name */
      [name: string]: SSRManifestEntry;
    };
  }

  declare interface SSRManifestEntry {
    /** Valid specifier to import */
    specifier: string;
    /** Export name */
    name: string;
  }
}

/** Available in client-side files. */
declare module "bun:bake/client" {
  /**
   * Callback is invoked when server-side code is changed. This can be used to
   * fetch a non-html version of the updated page to perform a faster reload. If
   * not provided, the client will perform a hard reload.
   *
   * Only one callback can be set. This function overwrites the previous one.
   */
  export function onServerSideReload(cb: () => void | Promise<void>): Promise<void>;
}

/** Available during development */
declare module "bun:bake/dev" {
  
};
