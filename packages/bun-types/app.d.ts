// This API is under heavy development. See #bake in the Bun Discord for more info.
// Definitions that are commented out are planned but not implemented.
//
// To use, add a TypeScript reference comment mentioning this file:
// /// <reference path="/path/to/bun/src/bake/bake.d.ts" />

/**
 * `bun:app` contains symbols usable in both the server and client boundaries of
 * an app built with the Bun Rendering API.
 */
declare module "bun:app" {
  type FrameworkDefinitionLike = Framework | `bun-framework-${string}` | (string & {});

  interface Config {
    /**
     * Specifies the framework configuration for this Bake application.
     *
     * This is THE CORE PROPERTY that determines how your app is structured and bundled.
     * It can be:
     * - A Framework object with full configuration (for advanced customization)
     * - A string package name prefixed with "bun-framework-" (e.g., "bun-framework-react")
     * - Any npm package name that exports a Framework configuration object
     *
     * When a string is provided:
     * 1. Bun first attempts to resolve "bun-framework-{name}"
     * 2. If that fails, it tries resolving "{name}" directly
     * 3. The resolved module MUST export a Framework object as default export
     * 4. The framework module is loaded and evaluated synchronously at config time
     *
     * The framework controls:
     * - File system routing behavior (how files map to routes)
     * - Server Components configuration
     * - React Fast Refresh settings
     * - Built-in module replacements
     * - Default bundler options
     *
     * @example
     * ```ts
     * // Using a pre-built framework
     * export default {app: {framework: "bun-framework-react"}};
     *
     * // Using a custom framework object
     * export default {app: {framework: customFrameworkConfig}};
     *
     * // Using a custom npm package
     * export default {app: {framework: "my-custom-bake-framework"}};
     * ```
     */
    framework: FrameworkDefinitionLike;

    // Note: To contribute to 'bun-framework-react', it can be run from this file:
    // https://github.com/oven-sh/bun/blob/main/src/bake/bun-framework-react/index.ts
    /**
     * Overrides and extends the bundler options provided by the framework.
     *
     * This property allows fine-tuning of the bundler behavior beyond what the framework sets.
     * Options specified here OVERRIDE and MERGE with framework defaults using the following rules:
     * - Primitive values (booleans, strings) override framework values
     * - Objects (define, loader) merge with framework values
     * - Arrays (conditions, drop) concatenate with framework values
     *
     * You can configure different options for:
     * - Top-level: applies to both client and server builds
     * - `client`: only affects browser bundle generation
     * - `server`: only affects server-side bundle generation
     * - `ssr`: only affects SSR graph when separateSSRGraph is enabled
     *
     * Hierarchy: client/server/ssr options override top-level options
     *
     * @default {} (uses framework defaults)
     *
     * @example
     * ```ts
     * bundlerOptions: {
     *   // Applied to all builds
     *   define: { "process.env.API_URL": "\"https://api.example.com\"" },
     *
     *   // Client-only minification
     *   client: { minify: true },
     *
     *   // Server-only conditions
     *   server: { conditions: ["node", "production"] }
     * }
     * ```
     */
    bundlerOptions?: BundlerOptions | undefined;

    /**
     * Additional Bun build plugins to apply during bundling.
     *
     * These plugins are executed AFTER framework-provided plugins, allowing you to:
     * - Override framework plugin behavior
     * - Add custom transformations
     * - Implement project-specific build logic
     *
     * Plugins are executed in the following order:
     * 1. Framework plugins (framework.plugins)
     * 2. User plugins (this property)
     *
     * Each plugin must have:
     * - A unique `name` property (non-empty string)
     * - A `setup()` function that configures the plugin behavior
     *
     * Plugin setup can be async - Bun will wait for all plugin promises to resolve
     * before starting the build process.
     *
     * @default undefined (no additional plugins)
     *
     * @example
     * ```ts
     * plugins: [{
     *   name: "my-custom-plugin",
     *   setup(build) {
     *     build.onLoad({ filter: /\.svg$/ }, async (args) => {
     *       // Custom SVG handling
     *     });
     *   }
     * }]
     * ```
     */
    plugins?: Bun.BunPlugin[] | undefined;
  }

  /**
   * Subset of Bun.build options available for Bake configuration.
   *
   * Only specific build options are exposed because Bake manages many aspects
   * of the build process internally for optimal hot-reloading and SSR support.
   *
   * Available options:
   * - `conditions`: Package.json export conditions for module resolution
   * - `define`: Global constant replacements at compile time
   * - `loader`: File extension to loader mappings
   * - `ignoreDCEAnnotations`: Disable dead code elimination annotations
   * - `drop`: Remove specific code patterns (console.*, debugger)
   *
   * Explicitly NOT available (and why):
   * - `format`: Locked to "internal_bake_dev" in dev, "esm" in production
   * - `entrypoints/outfile/outdir`: Managed by Bake's routing system
   * - `sourcemap`: Always "external" in dev for debugging, configurable in production
   * - `minifyIdentifiers`: Not allowed in dev (breaks generated code)
   * - `publicPath`: Set via framework configuration
   * - `emitDCEAnnotations`: Not useful for app bundles
   * - `banner/footer`: Not compatible with multi-file builds
   * - `external`: Would break module imports
   * - `plugins`: Use framework.plugins or top-level plugins instead
   *
   * @internal Implementation note: These restrictions ensure consistent behavior
   * across dev/prod and client/server boundaries
   */
  type BuildConfigSubset = Pick<
    Bun.BuildConfig,
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
    /**
     * Client-specific bundler configuration.
     *
     * Controls how JavaScript/TypeScript is bundled for browser execution.
     * These settings OVERRIDE the top-level bundler options for client builds.
     *
     * Client bundles:
     * - Target browser environments
     * - Include HMR runtime in development
     * - Support React Fast Refresh when configured
     * - Generate code splitting chunks in production
     * - Use "browser" condition in package.json exports
     * - Minify by default in production
     *
     * Common use cases:
     * - Adding browser-specific polyfills via `define`
     * - Removing server-only code via `drop`
     * - Setting browser-specific module conditions
     *
     * @example
     * ```ts
     * client: {
     *   define: { "process.env.IS_CLIENT": "true" },
     *   drop: ["console"], // Remove console.logs in client
     * }
     * ```
     */
    client?: BuildConfigSubset;

    /**
     * Server-specific bundler configuration.
     *
     * Controls how code is bundled for server-side execution (SSR and API routes).
     * These settings OVERRIDE the top-level bundler options for server builds.
     *
     * Server bundles:
     * - Target Bun runtime (Node.js compatible)
     * - Include "node" and "bun" conditions
     * - Support server components when configured
     * - Never include HMR runtime
     * - Can access file system and Node.js APIs
     * - Include "react-server" condition when server components enabled
     *
     * Common use cases:
     * - Setting server-only environment variables
     * - Including Node.js-specific modules
     * - Configuring database connection strings
     *
     * @example
     * ```ts
     * server: {
     *   define: { "process.env.DATABASE_URL": '"postgresql://..."' },
     *   conditions: ["node", "production"]
     * }
     * ```
     */
    server?: BuildConfigSubset;

    /**
     * SSR-specific bundler configuration (Server-Side Rendering).
     *
     * ONLY USED when `serverComponents.separateSSRGraph` is true.
     * Controls bundling for the separate SSR module graph.
     *
     * When separateSSRGraph is enabled:
     * - SSR uses a different React version than server components
     * - Client components are bundled separately for SSR
     * - Allows server components and SSR to coexist with different React versions
     * - SSR graph does NOT include "react-server" condition
     *
     * This separation enables:
     * - Server components using React's async components
     * - SSR using standard React for client component rendering
     * - Both running in the same process without conflicts
     *
     * If separateSSRGraph is false, these options are IGNORED.
     *
     * @example
     * ```ts
     * ssr: {
     *   conditions: ["node"], // No "react-server" for SSR
     *   define: { "process.env.IS_SSR": "true" }
     * }
     * ```
     */
    ssr?: BuildConfigSubset;
  };

  /**
   * Framework configuration object that defines how Bake processes your application.
   *
   * A Framework is a set of conventions and configurations that tell Bake:
   * - How to discover and route files (file system routing)
   * - How to handle server/client boundaries (server components)
   * - How to enable hot reloading features (React Fast Refresh)
   * - What bundler settings to apply
   *
   * Framework authors use this to create reusable configurations that work
   * with specific UI libraries (React, Vue, Svelte, etc.) or implement
   * custom routing conventions.
   *
   * All path properties are resolved as import specifiers, meaning they can be:
   * - Relative paths ("./my-module")
   * - Node modules ("react-refresh/runtime")
   * - Built-in modules (defined in builtInModules)
   *
   * Resolution happens in this order:
   * 1. Check builtInModules for the exact path
   * 2. Resolve as a normal import from the project root
   *
   * @example
   * ```ts
   * const myFramework: Framework = {
   *   fileSystemRouterTypes: [{
   *     root: "src/pages",
   *     style: "nextjs-pages",
   *     // ... other routing config
   *   }],
   *   reactFastRefresh: { importSource: "react-refresh/runtime" },
   *   serverComponents: { ... }
   * }
   * ```
   */
  interface Framework {
    /**
     * Default bundler options provided by the framework.
     *
     * These options serve as BASE DEFAULTS that users can override via
     * their own bundlerOptions in the app config.
     *
     * Merging behavior:
     * - User's top-level bundlerOptions OVERRIDE framework bundlerOptions
     * - User's client/server/ssr options OVERRIDE framework's respective options
     * - Objects (define, loader) are MERGED (user values win)
     * - Arrays (conditions, drop) are CONCATENATED
     * - Primitives are REPLACED
     *
     * Framework authors should set sensible defaults here that make their
     * framework "just work" without requiring user configuration.
     *
     * Common framework defaults:
     * - React frameworks: set JSX runtime to automatic
     * - Node frameworks: add "node" condition
     * - SSR frameworks: configure server and client differently
     *
     * @default {} (no framework-specific bundler options)
     *
     * @example
     * ```ts
     * bundlerOptions: {
     *   // React framework defaults
     *   define: { "process.env.NODE_ENV": '"development"' },
     *   client: {
     *     conditions: ["browser"],
     *   },
     *   server: {
     *     conditions: ["node"],
     *   }
     * }
     * ```
     */
    bundlerOptions?: BundlerOptions | undefined;

    /**
     * Defines how the file system maps to application routes.
     *
     * This is THE CORE of how Bake discovers and bundles your application pages.
     * Each entry defines a separate routing root with its own conventions.
     *
     * Multiple router types can coexist:
     * - Pages router at "/pages" with Next.js conventions
     * - API routes at "/api" with different conventions
     * - Admin panel at "/admin" with custom routing
     *
     * Each router type specifies:
     * - Where to look for files (root directory)
     * - How to interpret file names as routes (style)
     * - What files to bundle for client/server
     * - What to ignore
     *
     * The array is processed in order, with first match wins for overlapping routes.
     *
     * Empty array means no file-system routing (you handle routing manually).
     *
     * @default [] (no file-system routing)
     *
     * @example
     * ```ts
     * fileSystemRouterTypes: [
     *   {
     *     root: 'src/pages',
     *     style: 'nextjs-pages',
     *     prefix: '/',
     *     serverEntryPoint: './server.tsx',
     *     clientEntryPoint: './client.tsx'
     *   },
     *   {
     *     root: 'src/api',
     *     style: 'nextjs-app-routes',
     *     prefix: '/api',
     *     serverEntryPoint: './api-server.tsx',
     *     clientEntryPoint: null // API routes are server-only
     *   }
     * ]
     * ```
     */
    fileSystemRouterTypes?: FrameworkFileSystemRouterType[];

    // /**
    //  * A list of directories that should be served statically. If the directory
    //  * does not exist in the user's project, it is ignored.
    //  *
    //  * Example: 'public' or 'static'
    //  *
    //  * Different frameworks have different opinions, some use 'static', some use
    //  * 'public'.
    //  * @default []
    //  */
    // staticRouters?: Array<StaticRouter> | undefined;

    // /**
    //  * Add extra modules. This can be used to, for example, replace `react` with
    //  * a different resolution.
    //  *
    //  * Internally, Bun's `react-server-components` framework uses this to embed
    //  * its files in the `bun` binary.
    //  * @default {}
    //  */
    // builtInModules?: BuiltInModule[] | undefined;

    /**
     * Enables React Server Components (RSC) or similar server/client component boundaries.
     *
     * When enabled, Bake processes "use client" and "use server" directives to create
     * boundaries between server and client code. This enables:
     * - Components that only run on the server (async components, direct DB access)
     * - Automatic code splitting at component boundaries
     * - Streaming server rendering with Suspense
     * - Server Actions (server-side functions callable from client)
     *
     * The bundler creates THREE distinct module graphs:
     * 1. Server graph: Contains server components and server-only code
     * 2. Client graph: Contains client components and browser code
     * 3. SSR graph (optional): Separate graph for SSR when separateSSRGraph=true
     *
     * Files with "use client" become client component boundaries:
     * - Bundled separately for the browser
     * - On server, replaced with reference stubs that call registerClientReference
     * - Props are serialized when crossing the boundary
     *
     * Files with "use server" become server component boundaries:
     * - Only run on the server
     * - Can be async and use server-only APIs
     * - Results are streamed to the client
     *
     * undefined means server components are DISABLED.
     *
     * @default undefined (server components disabled)
     *
     * @example
     * ```ts
     * serverComponents: {
     *   separateSSRGraph: true, // Use different React for SSR vs RSC
     *   serverRuntimeImportSource: 'react-server-dom/server',
     *   serverRegisterClientReferenceExport: 'registerClientReference'
     * }
     * ```
     */
    serverComponents?: ServerComponentsOptions | undefined;

    /**
     * Enables React Fast Refresh for hot module replacement with state preservation.
     *
     * Fast Refresh provides a superior development experience by:
     * - Preserving component state during code changes
     * - Only re-rendering changed components
     * - Recovering from runtime errors gracefully
     * - Providing clear error boundaries
     *
     * Three ways to configure:
     * - `true`: Use default React Fast Refresh ("react-refresh/runtime")
     * - `false` or undefined: Disable Fast Refresh
     * - Object: Customize the runtime import source
     *
     * How it works:
     * 1. In development, Bake injects refresh registration calls
     * 2. Every React component is registered with a unique ID
     * 3. On hot update, components are patched in-place
     * 4. State and refs are preserved across updates
     *
     * Only functions starting with uppercase letters are registered
     * (React component convention).
     *
     * While designed for React, the transform could theoretically work with
     * other frameworks that follow similar component conventions.
     *
     * @default false (Fast Refresh disabled)
     *
     * @example
     * ```ts
     * // Use default React Fast Refresh
     * reactFastRefresh: true
     *
     * // Use custom Fast Refresh implementation
     * reactFastRefresh: {
     *   importSource: '@my/custom-refresh-runtime'
     * }
     *
     * // Disable Fast Refresh
     * reactFastRefresh: false
     * ```
     */
    reactFastRefresh?: boolean | ReactFastRefreshOptions | undefined;

    /**
     * Framework-provided bundler plugins.
     *
     * These plugins are executed BEFORE user plugins, establishing the base
     * transformation pipeline for the framework.
     *
     * Execution order:
     * 1. Framework plugins (this property) - run first
     * 2. User plugins (from app config) - run second
     *
     * This order ensures:
     * - Framework establishes core behavior
     * - Users can override or extend framework behavior
     * - Framework plugins can't accidentally break user customizations
     *
     * Common framework plugin uses:
     * - Transform framework-specific file types
     * - Inject framework runtime code
     * - Handle special imports (e.g., "virtual:framework")
     * - Set up framework-specific optimizations
     *
     * Each plugin must have:
     * - Unique `name` property
     * - `setup()` function
     *
     * Plugins are initialized synchronously during config parsing.
     * Async operations in setup() will block the build start.
     *
     * @default undefined (no framework plugins)
     *
     * @example
     * ```ts
     * plugins: [{
     *   name: 'framework-mdx',
     *   setup(build) {
     *     build.onLoad({ filter: /\.mdx$/ }, async (args) => {
     *       // Transform MDX to JSX
     *     });
     *   }
     * }]
     * ```
     */
    plugins?: Bun.BunPlugin[] | undefined;

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
   * A high-level overview of what server components means exists in the React
   * Docs: https://react.dev/reference/rsc/server-components
   *
   * When enabled, files with "use server" and "use client" directives will
   * get special processing according to this object, in combination with the
   * framework-specified entry points for server rendering and browser
   * interactivity.
   */
  interface ServerComponentsOptions {
    /**
     * Controls whether SSR uses a separate module graph from server components.
     *
     * THIS IS A CRITICAL DECISION that affects your entire application architecture.
     *
     * When `true` (React's approach):
     * - THREE separate module graphs: Server, Client, and SSR
     * - Server components use "react-server" condition (async React)
     * - SSR uses standard React (no "react-server" condition)
     * - Client components are bundled TWICE (once for client, once for SSR)
     * - Allows React 19+ async components on server, standard React for SSR
     * - More complex but enables full React Server Components features
     * - Higher memory usage (multiple React versions in memory)
     *
     * When `false` (simpler approach):
     * - TWO module graphs: Server+SSR combined, Client separate
     * - Both server components and SSR use the same React
     * - Client components bundled once, used for both client and SSR
     * - Cannot use React async components (they require separation)
     * - Simpler mental model and less memory usage
     * - Works for basic "use client" boundaries without full RSC
     *
     * To cross between graphs when true, use import attributes:
     * ```ts
     * import * as ReactDOM from 'react-dom/server' with { bunBakeGraph: 'ssr' };
     * ```
     *
     * NO DEFAULT PROVIDED - you must explicitly choose based on your needs.
     * If unsure, choose `false` for simplicity unless you need React async components.
     */
    separateSSRGraph: boolean;
    /**
     * Import source for the server components runtime.
     *
     * This module provides the functions that handle client/server boundaries:
     * - `registerClientReference`: Marks client components on the server
     * - `registerServerReference`: Marks server actions
     * - Component serialization/deserialization logic
     * - Streaming protocols for RSC payloads
     *
     * The module MUST export the functions specified in:
     * - `serverRegisterClientReferenceExport` (default: "registerClientReference")
     * - (Future) `serverRegisterServerReferenceExport` for server actions
     *
     * Common values:
     * - React: "react-server-dom-webpack/server" or "react-server-dom-bun/server"
     * - Custom: Your own RSC runtime implementation
     *
     * This import is resolved at build time and bundled into the server.
     * Resolution follows normal module resolution rules (node_modules, relative paths).
     *
     * @example "react-server-dom-webpack/server"
     * @example "./my-rsc-runtime"
     * @example "@my-org/rsc-runtime"
     */
    serverRuntimeImportSource: string;
    /**
     * Name of the export from serverRuntimeImportSource that registers client components.
     *
     * This function is called in generated stub modules when server code imports client code.
     * Every "use client" component gets wrapped with this function on the server.
     *
     * The function signature differs based on `separateSSRGraph`:
     *
     * When `separateSSRGraph: true` (opaque references):
     * ```ts
     * export const Button = registerClientReference(
     *   function() { throw new Error('Cannot call client component on server') },
     *   "src/Button.tsx",     // Source file ID (minified in prod: "a1")
     *   "Button"              // Export name (minified in prod: "b")
     * );
     * ```
     * The last two params are OPAQUE STRINGS looked up in the manifest.
     *
     * When `separateSSRGraph: false` (direct references):
     * ```ts
     * export const Button = registerClientReference(
     *   function() { ... },
     *   "/_bun/client-123.js", // Actual client bundle URL
     *   "Button"               // Actual export name in bundle
     * );
     * ```
     * The last two params are DIRECT REFERENCES for client loading.
     *
     * The difference is crucial:
     * - With SSR graph: Abstract references requiring manifest lookup
     * - Without SSR graph: Concrete URLs for immediate loading
     *
     * Your runtime must implement this function to handle the boundary.
     *
     * @default "registerClientReference"
     *
     * @example
     * ```ts
     * // React's implementation
     * serverRegisterClientReferenceExport: "registerClientReference"
     *
     * // Custom implementation
     * serverRegisterClientReferenceExport: "createClientBoundary"
     * ```
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
     * `injectIntoGlobalHook(window): void` Called on first startup, before
     * the user entrypoint.
     *
     * `register(component, uniqueId: string): void` Called on every function
     * that starts with an uppercase letter. These may or may not be
     * components, but they are always functions.
     *
     * `createSignatureFunctionForTransform(): ReactRefreshSignatureFunction`
     * TODO: document. A passing no-op for this api is `return () => {}`
     *
     * @default "react-refresh/runtime"
     */
    importSource: string | undefined;
  }

  type ReactRefreshSignatureFunction = () =>
    | void
    | ((func: Function, hash: string, force?: boolean, customHooks?: () => Function[]) => void);

  /** This API is similar, but unrelated to `Bun.FileSystemRouter`  */
  interface FrameworkFileSystemRouterType {
    /**
     * Root directory to scan for route files, relative to project root.
     *
     * This is WHERE Bake looks for files that become routes.
     * The path is relative to your project root (where package.json lives).
     *
     * Bake recursively scans this directory for files matching:
     * - Extensions specified in `extensions` property
     * - Style conventions specified in `style` property
     * - Excluding directories in `ignoreDirs`
     * - Excluding underscored files if `ignoreUnderscores` is true
     *
     * The directory structure maps to URL structure based on `style`.
     * For example, with "nextjs-pages" style:
     * - `src/pages/index.tsx` → `/`
     * - `src/pages/about.tsx` → `/about`
     * - `src/pages/blog/[slug].tsx` → `/blog/:slug`
     *
     * This directory MUST exist at build time or Bake will error.
     *
     * @example "src/pages"
     * @example "app"
     * @example "routes"
     */
    root: string;

    /**
     * URL prefix for all routes from this router.
     *
     * This prepends a path segment to all discovered routes.
     * Useful for mounting route groups at specific paths.
     *
     * How it works:
     * - Route: `pages/users.tsx`
     * - Without prefix: `/users`
     * - With prefix "/api": `/api/users`
     * - With prefix "/v2": `/v2/users`
     *
     * Rules:
     * - Must start with "/"
     * - No trailing slash (use "/api", not "/api/")
     * - Empty string treated as "/"
     * - Prefixes stack when using multiple routers
     *
     * Common patterns:
     * - API versioning: prefix: "/api/v1"
     * - Admin routes: prefix: "/admin"
     * - Localization: prefix: "/en-US"
     *
     * @default "/"
     *
     * @example
     * ```ts
     * // Mount API routes at /api
     * { root: "src/api", prefix: "/api" }
     *
     * // Version your API
     * { root: "src/api/v2", prefix: "/api/v2" }
     * ```
     */
    prefix?: string | undefined;

    /**
     * Path to the server-side rendering entry point.
     *
     * This file orchestrates HOW routes are rendered on the server.
     * It must export a ServerEntryPoint object with a `render` function.
     *
     * The render function receives:
     * 1. The incoming Request
     * 2. RouteMetadata (matched route module, params, layouts)
     * 3. Optional AsyncLocalStorage for request context
     *
     * And must return a Response (usually HTML).
     *
     * This is where you:
     * - Call your framework's SSR function (e.g., ReactDOMServer.renderToString)
     * - Inject the rendered HTML into an HTML template
     * - Add <script> tags for client hydration
     * - Handle errors and 404s
     * - Set response headers (Cache-Control, etc.)
     *
     * When server components are enabled, import manifests here:
     * ```ts
     * import { serverManifest, ssrManifest } from 'bun:app/server'
     * ```
     *
     * Path resolution:
     * - Relative paths resolved from project root
     * - Node modules resolved normally
     * - Must exist at build time
     *
     * @example "./server.tsx"
     * @example "./src/entry.server.tsx"
     * @example "my-framework/server"
     */
    serverEntryPoint: string;

    /**
     * Path to the client-side hydration entry point.
     *
     * This file controls HOW routes become interactive in the browser.
     * If not provided, routes are server-only (no client JavaScript).
     *
     * When provided, this file:
     * - Runs once when the page loads
     * - Hydrates server-rendered HTML
     * - Sets up client-side routing
     * - Initializes your framework (React, Vue, etc.)
     *
     * Setting to null/undefined means:
     * - No client bundle generated
     * - No JavaScript sent to browser
     * - Pure server-rendered HTML
     * - Good for static content, forms, APIs
     *
     * The file typically:
     * 1. Imports your framework's hydration function
     * 2. Finds the root element
     * 3. Hydrates with the same component tree as server
     *
     * Example React client entry:
     * ```ts
     * import { hydrateRoot } from 'react-dom/client';
     * import { App } from './App';
     *
     * hydrateRoot(document.getElementById('root'), <App />);
     * ```
     *
     * Path resolution same as serverEntryPoint.
     *
     * @default undefined (no client hydration)
     *
     * @example "./client.tsx"
     * @example null // Explicitly no client
     * @example "my-framework/client"
     */
    clientEntryPoint?: string | null | undefined;

    /**
     * Whether to ignore files and directories starting with underscore.
     *
     * When true:
     * - Skips directories starting with "_" entirely (won't traverse)
     * - Ignores files starting with "_" as routes
     * - EXCEPTION: Special files like "_layout.tsx" still work (framework-specific)
     *
     * This follows the convention that underscore = private/internal.
     *
     * Common uses for underscore files:
     * - Shared components: "_components/Button.tsx"
     * - Utilities: "_utils/helpers.ts"
     * - Partial templates: "_header.tsx"
     *
     * Why exceptions exist:
     * Some frameworks use underscore for special files:
     * - Next.js: "_app.tsx", "_document.tsx"
     * - Remix/SvelteKit: "_layout.tsx"
     * These are recognized by name, not as routes.
     *
     * @default false (underscores are treated normally)
     *
     * @example
     * ```ts
     * // With ignoreUnderscores: true
     * // pages/_utils/helper.ts → IGNORED
     * // pages/_secret.tsx → IGNORED
     * // pages/_layout.tsx → RECOGNIZED (special case)
     * // pages/public.tsx → ROUTED to /public
     * ```
     */
    ignoreUnderscores?: boolean;

    /**
     * Directories to completely skip when scanning for routes.
     *
     * These directories are NEVER traversed, even if they contain
     * valid route files. Use this to exclude:
     * - Dependencies (node_modules)
     * - Version control (.git, .svn)
     * - Build outputs (dist, .next)
     * - Tests (__tests__, tests)
     * - Config directories (.vscode, .idea)
     *
     * Matching is by exact name at any level:
     * - "node_modules" matches "./node_modules" and "./src/node_modules"
     * - ".git" matches "./.git" and "./submodule/.git"
     *
     * Performance tip: Add directories with many files that aren't routes.
     * This speeds up route discovery significantly.
     *
     * Patterns NOT supported (use exact names only):
     * - Wildcards: "test*" won't work
     * - Paths: "src/ignore" won't work
     * - Regex: Not supported
     *
     * @default ["node_modules", ".git"]
     *
     * @example
     * ```ts
     * // Ignore test directories
     * ignoreDirs: ["node_modules", ".git", "__tests__", "tests"]
     *
     * // Ignore build artifacts
     * ignoreDirs: ["node_modules", ".git", "dist", ".next", ".nuxt"]
     * ```
     */
    ignoreDirs?: string[] | undefined;

    /**
     * File extensions to consider as potential routes.
     *
     * Controls which files Bake examines when building routes.
     * Only files with these extensions are processed.
     *
     * Two modes:
     * 1. Array of extensions: Only match specified extensions
     * 2. "*": Match ALL files (use with caution)
     *
     * Extension format:
     * - Include the dot: ".tsx" not "tsx"
     * - Case sensitive: ".tsx" won't match ".TSX"
     * - Full extension: ".test.ts" is different from ".ts"
     *
     * Common patterns:
     * - React: [".tsx", ".jsx"]
     * - Vue: [".vue"]
     * - Mixed: [".tsx", ".jsx", ".mdx"]
     * - API routes: [".ts", ".js"]
     *
     * Performance impact:
     * - Fewer extensions = faster scanning
     * - "*" is slowest (examines everything)
     * - Be specific to avoid processing non-route files
     *
     * @default [".jsx", ".tsx", ".js", ".ts", ".cjs", ".cts", ".mjs", ".mts"]
     *
     * @example
     * ```ts
     * // React/Next.js apps
     * extensions: [".tsx", ".jsx"]
     *
     * // API routes only
     * extensions: [".ts"]
     *
     * // Include MDX pages
     * extensions: [".tsx", ".jsx", ".mdx"]
     *
     * // Match everything (careful!)
     * extensions: "*"
     * ```
     */
    extensions?: string[] | "*" | undefined;

    /**
     * Routing convention to use for mapping files to URLs.
     *
     * This determines HOW file names and paths become route patterns.
     * Different styles follow different framework conventions.
     *
     * Built-in styles:
     *
     * "nextjs-pages" (Next.js Pages Router style):
     * - Any `.tsx` file becomes a route
     * - `index.tsx` → `/`
     * - `about.tsx` → `/about`
     * - `[id].tsx` → `/:id` (dynamic)
     * - `[...slug].tsx` → `/*` (catch-all)
     * - `_layout.tsx` wraps child routes
     *
     * "nextjs-app-ui" (Next.js App Router UI routes):
     * - Only `page.tsx` files become routes
     * - `layout.tsx` wraps children
     * - `loading.tsx` shows during loading
     * - `error.tsx` handles errors
     * - Folders define URL structure
     *
     * "nextjs-app-routes" (Next.js App Router API routes):
     * - Only `route.ts` files become endpoints
     * - Must export GET, POST, etc. functions
     * - No layouts or UI components
     *
     * CustomFileSystemRouterFunction:
     * - Your own function to classify files
     * - Receives file path, returns route info
     * - Maximum flexibility for custom conventions
     *
     * @example
     * ```ts
     * // Next.js Pages style
     * style: "nextjs-pages"
     *
     * // Custom function
     * style: (path) => {
     *   if (path.endsWith('.route.tsx'))
     *     return { pattern: path.replace('.route.tsx', ''), type: 'route' }
     *   return null;
     * }
     * ```
     */
    style: "nextjs-pages" | "nextjs-app-ui" | "nextjs-app-routes" | CustomFileSystemRouterFunction;

    /**
     * Whether to collect and provide layout components to the render function.
     *
     * When true:
     * - Bake identifies layout files based on the `style`
     * - Collects all layouts from route to root
     * - Provides them in RouteMetadata.layouts array
     * - Ordered from innermost to outermost
     *
     * This enables nested layouts where each level wraps its children:
     * ```
     * pages/
     *   _layout.tsx         (root layout)
     *   dashboard/
     *     _layout.tsx       (dashboard layout)
     *     settings.tsx      (settings page)
     * ```
     *
     * Result for /dashboard/settings:
     * ```ts
     * routeMetadata.layouts = [
     *   dashboardLayout,  // innermost
     *   rootLayout        // outermost
     * ]
     * ```
     *
     * Your render function typically nests them:
     * ```tsx
     * let element = <Page />;
     * for (const layout of layouts) {
     *   element = <layout.default>{element}</layout.default>;
     * }
     * ```
     *
     * When false:
     * - layouts array is empty
     * - You handle layout logic yourself
     *
     * @default false (layouts not collected)
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
   * Bun will call this function for every found file. This function
   * classifies each file's role in the file system routing.
   */
  type CustomFileSystemRouterFunction = (candidatePath: string) => CustomFileSystemRouterResult;

  type CustomFileSystemRouterResult =
    /** Skip this file */
    | undefined
    | null
    /**
     * Use this file as a route. Routes may nest, where a framework can use
     * parent routes to implement layouts.
     */
    | {
        /**
         * Route pattern can include `:param` for parameters, '*' for catch-all,
         * and '*?' for optional catch-all. Parameters must take the full
         * component of a path segment. Parameters cannot have constraints at
         * this moment.
         */
        pattern: string;
        type: "route" | "layout" | "extra";
      };

  namespace __internal {
    type RequestContext = {
      responseOptions: ResponseInit;
      streaming: boolean;
      streamingStarted?: boolean;
    };
  }

  interface ServerEntryPoint {
    /**
     * Whether this server supports streaming responses.
     *
     * When true:
     * - Response can be sent in chunks as rendered
     * - Enables React 18+ streaming SSR (renderToPipeableStream)
     * - Better Time to First Byte (TTFB)
     * - Progressive page loading
     * - Suspense boundaries can stream in later
     *
     * When false/undefined:
     * - Complete response generated before sending
     * - Uses traditional SSR (renderToString)
     * - Simple but higher TTFB
     * - All content ready at once
     *
     * Implementation requirements for streaming:
     * - Return ReadableStream or Response with stream body
     * - Handle backpressure properly
     * - Manage error boundaries during streaming
     *
     * @default undefined (no streaming)
     */
    readonly streaming?: boolean;

    /**
     * Rendering mode for this server.
     *
     * "ssr" (Server-Side Rendering):
     * - Dynamic rendering per request
     * - Can access request headers, cookies
     * - Fresh data on every request
     * - Higher server load
     * - Good for personalized content
     *
     * "static" (Static Site Generation):
     * - Pre-rendered at build time
     * - Same HTML for all requests
     * - Can't access request data
     * - Cacheable, fast serving
     * - Good for public content
     *
     * This hint helps Bake optimize:
     * - Static mode may prerender routes
     * - SSR mode keeps routes dynamic
     * - Affects caching strategies
     *
     * @default undefined (framework decides)
     */
    readonly mode?: "ssr" | "static";

    /**
     * The core rendering function that turns routes into HTTP responses.
     *
     * This is THE HEART of server-side rendering. It's called for every
     * request that matches a route, and must return an HTTP Response.
     *
     * Parameters:
     *
     * @param request - The incoming HTTP request
     *   - Contains URL, method, headers, body
     *   - Use for auth, cookies, content negotiation
     *   - Same Request object from Fetch API
     *
     * @param routeMetadata - Information about the matched route
     *   - `.pageModule`: The route's exported module
     *   - `.params`: Dynamic route parameters
     *   - `.layouts`: Parent layout components (if enabled)
     *   - `.modules`: Client JS files needed
     *   - `.styles`: CSS files needed
     *
     * @param storage - Optional AsyncLocalStorage for request context
     *   - Thread-safe request-scoped storage
     *   - Share data across async operations
     *   - Used for streaming SSR coordination
     *
     * @returns Response or Promise<Response>
     *   - HTML response for pages
     *   - JSON for API routes
     *   - Redirects, errors, etc.
     *
     * Typical implementation:
     * 1. Extract route component from metadata
     * 2. Render component to HTML string/stream
     * 3. Inject into HTML template
     * 4. Add <script> tags for hydration
     * 5. Return Response with appropriate headers
     *
     * The routeMetadata.pageModule shape is framework-specific.
     * Common patterns:
     * - React: `{ default: Component }`
     * - API: `{ GET, POST, DELETE, ... }`
     * - Custom: Whatever your framework needs
     */
    render: (
      request: Request,
      routeMetadata: RouteMetadata,
      storage: import("node:async_hooks").AsyncLocalStorage<__internal.RequestContext> | undefined,
    ) => Bun.MaybePromise<Response>;

    /**
     * Pre-renders routes at build time for static generation.
     *
     * Called during BUILD, not at request time. Generates static
     * HTML/assets that can be served without running application code.
     *
     * When this runs:
     * - Static builds: All routes
     * - Dynamic builds: Routes without parameters
     * - Hybrid builds: Specified routes only
     *
     * No request object because:
     * - Runs at build time, not request time
     * - Can't access cookies, headers, etc.
     * - Must generate generic content
     *
     * Can generate multiple files:
     * - index.html (main page)
     * - data.json (for client navigation)
     * - Multiple language versions
     * - Different formats (AMP, etc.)
     *
     * Returns null to skip prerendering this route.
     *
     * `import.meta.env.STATIC` is true during static builds,
     * allowing conditional logic:
     * ```ts
     * if (import.meta.env.STATIC) {
     *   // Use build-time data
     * } else {
     *   // Use runtime data
     * }
     * ```
     *
     * @param routeMetadata - Same as render(), minus request
     * @returns PrerenderResult with generated files, or null to skip
     */
    prerender?: (routeMetadata: RouteMetadata) => Bun.MaybePromise<PrerenderResult | null>;

    // TODO: prerenderWithoutProps (for partial prerendering)
    /**
     * Generates parameter combinations for dynamic routes during static builds.
     *
     * This tells Bake WHICH versions of dynamic routes to pre-render.
     * Only called for routes with parameters (e.g., `/blog/:slug`, `/user/:id`).
     *
     * For route `/blog/[slug].tsx`, this might return:
     * ```ts
     * {
     *   pages: [
     *     { slug: 'hello-world' },
     *     { slug: 'about-us' },
     *     { slug: 'contact' }
     *   ],
     *   exhaustive: true
     * }
     * ```
     *
     * This generates:
     * - `/blog/hello-world`
     * - `/blog/about-us`
     * - `/blog/contact`
     *
     * The `exhaustive` flag is CRITICAL:
     * - `true`: These are ALL possible values
     *   - Static builds will error on unknown routes
     *   - Fastest serving (everything pre-built)
     *   - Use for closed sets (products, categories)
     *
     * - `false`: More values exist
     *   - Unknown routes handled at runtime
     *   - Hybrid static/dynamic serving
     *   - Use for open sets (user content, timestamps)
     *
     * Three return formats:
     *
     * 1. Object with pages array:
     * ```ts
     * return { pages: [...], exhaustive: true }
     * ```
     *
     * 2. Async iterator (for large datasets):
     * ```ts
     * async function* getParams() {
     *   for (const slug of await fetchSlugs()) {
     *     yield { slug };
     *   }
     *   return { exhaustive: false };
     * }
     * ```
     *
     * 3. Regular iterator (synchronous):
     * ```ts
     * function* getParams() {
     *   yield* slugArray.map(slug => ({ slug }));
     * }
     * ```
     *
     * Performance tip: Yield results as available for parallel rendering.
     *
     * @param paramsMetadata - Route and layout information
     * @returns Iterator or object with parameter combinations
     */
    getParams?: (paramsMetadata: ParamsMetadata) => Bun.MaybePromise<GetParamIterator>;

    /**
     * Maps Accept header content types to static file paths.
     *
     * Enables content negotiation for pre-rendered files.
     * When a request comes in, Bake checks the Accept header
     * and serves the appropriate pre-rendered version.
     *
     * Use cases:
     * - Serve WebP to supported browsers, JPEG to others
     * - Provide JSON data for API clients, HTML for browsers
     * - Deliver AMP pages to AMP crawlers
     * - Return RSS/Atom feeds for feed readers
     *
     * How it works:
     * 1. Request has Accept: "application/json, text/html"
     * 2. Check this mapping for matches
     * 3. Serve pre-rendered file if found
     * 4. Fall back to normal rendering if not
     *
     * The paths are relative to the prerendered output.
     *
     * @example
     * ```ts
     * contentTypeToStaticFile: {
     *   'application/json': 'data.json',
     *   'application/ld+json': 'structured-data.json',
     *   'application/rss+xml': 'feed.rss',
     *   'text/html': 'index.html',
     *   'application/vnd.amp+html': 'amp.html'
     * }
     * ```
     *
     * @default undefined (no content negotiation)
     */
    contentTypeToStaticFile?: Record<string, string>;
  }

  type GetParamIterator =
    | AsyncIterable<Record<string, string | string[]>, GetParamsFinalOpts>
    | Iterable<Record<string, string | string[]>, GetParamsFinalOpts>
    | ({ pages: Array<Record<string, string | string[]>> } & GetParamsFinalOpts);

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
    default: (dev: DevServerHookAPI) => Bun.MaybePromise<void>;
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
    readonly layouts: ReadonlyArray<{
      default: import("react").JSXElementConstructor<
        import("react").PropsWithChildren<{
          params: Record<string, string | string[]> | null;
        }>
      >;
    }>;

    /**
     * Received route params. `null` if the route does not take params
     */
    readonly params: null | Record<string, string | string[]>;

    readonly request?: Request | undefined;

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
    readonly pageModule: ServerEntryPoint;
    readonly layouts: ReadonlyArray<{ default: import("react").JSXElementConstructor<unknown> }>;
  }
}

declare module "bun" {
  namespace Serve {
    interface BaseServeOptions<WebSocketData> {
      /** Add a fullstack web app to this server using Bun Bake */
      app?: import("bun:app").Config | import("bun:app").FrameworkDefinitionLike | undefined;
    }
  }

  // TODO(@alii): Before merging, figure out if this was ever implemented in
  // Bake. These types were copied over from the previous bake.d.ts file
  // interface PluginBuilder {
  //   /**
  //    * Inject a module into the development server's runtime, to be loaded
  //    * before all other user code.
  //    */
  //   addPreload(...args: any): void;
  // }

  interface OnLoadArgs {
    /**
     * When using server-components, the same bundle has both client and server
     * files; A single plugin can operate on files from both module graphs.
     * Outside of server-components, this will be "client" when the target is
     * set to "browser" and "server" otherwise.
     */
    side: "server" | "client";
  }
}

/**
 * Available in server-side files only
 */
declare module "bun:app/server" {
  // NOTE: The format of these manifests will likely be customizable in the future.

  /**
   * This follows the requirements for React's Server Components manifest, which
   * is a mapping of component IDs to the client-side file it is exported in.
   * The specifiers from here are to be imported in the client.
   *
   * To perform SSR with client components, see `ssrManifest`
   */
  const serverManifest: ServerManifest;

  /**
   * Entries in this manifest map from client-side files to their respective SSR
   * bundles. They can be loaded by `await import()` or `require()`.
   */
  const ssrManifest: SSRManifest;

  /** (insert teaser trailer) */
  const actionManifest: null;

  interface ServerManifest {
    /**
     * Concatenation of the component file ID and the instance id with '#'
     * Example: 'components/Navbar.tsx#default' (dev) or 'l2#a' (prod/minified)
     *
     * The component file ID and the instance id are both passed to `registerClientReference`
     */
    [combinedComponentId: string]: ServerManifestEntry;
  }

  interface ServerManifestEntry {
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

    /**
     * Currently not implemented; always an empty array
     */
    chunks: [];
  }

  interface SSRManifest {
    /** ServerManifest[...].id */
    [id: string]: {
      /** ServerManifest[...].name */
      [name: string]: SSRManifestEntry;
    };
  }

  interface SSRManifestEntry {
    /** Valid specifier to import */
    specifier: string;
    /** Export name */
    name: string;
  }
}

/**
 * Available in client-side files.
 */
declare module "bun:app/client" {
  /**
   * Callback is invoked when server-side code is changed. This can be used to
   * fetch a non-html version of the updated page to perform a faster reload. If
   * not provided, the client will perform a hard reload.
   *
   * Only one callback can be set. Calling this function will overwrite any
   * previously set callback.
   */
  export function onServerSideReload(cb: () => void | Promise<void>): void;
}
