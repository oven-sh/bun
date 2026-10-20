// `bun bake build`: builds the app in the working directory into `dist/`, for `bun dist/server.js`.
//
// Two `Bun.build()` runs:
// - The browser build: the `.html` pages, and one entry per page of a framework router with a client
//   entry point. With `clientPages`, it loads the page and its layouts, then the client entry point,
//   which reads them from `route` of `bun:bake/client`, as in `bun bake`.
// - The server build: `dist/server.js`, which imports `app/server.ts`, the framework's server entry
//   points and the pages, and starts the server of `src/runtime/bake/production/server.ts`.
const path = require("node:path");
const fs = require("node:fs");

// `bake.config.ts` and the plugins run before the code that uses these, and can change them.
const RegExpEscape = RegExp.escape;
const MapGroupBy = Map.groupBy;
const ArrayPrototypeToReversed = Array.prototype.toReversed;

const buildFramework = $newRustFunction("bake/config/plugins.rs", "buildFramework", 1);
const serveStaticEnv = $newRustFunction("bake/config/plugins.rs", "serveStaticEnv", 0);
const serveStaticPlugins = $newRustFunction("bake/config/plugins.rs", "serveStaticPlugins", 0);
const productionServerCode = $newRustFunction("bake/config/plugins.rs", "productionServerCode", 0);
const { FrameworkRouter } = $rust("FrameworkRouter.rs", "JSFrameworkRouter.getBindings") as {
  FrameworkRouter: new (options: object) => { toJSON(): RouteNode };
};

type Helpers = {
  BakeError: new (message: string, fixable: boolean) => Error;
  display: (file: string) => string;
  loadConfig: (cwd: string, mode: "development" | "production") => Promise<{ plugins: any[]; framework: any }>;
  findHtmlPages: (pagesDir: string) => { route: string; url: string; file: string }[];
  componentPages: (pagesDir: string) => string[];
  checkPageClashes: (pagesDir: string, components: string[], pages: { route: string; file: string }[]) => void;
  checkReactForPages: (cwd: string) => void;
};

/** A node of `FrameworkRouter.toJSON()`. */
type RouteNode = { part: string; page: string | null; layout: string | null; children: RouteNode[] };

/** A page of a framework router. */
type FrameworkPage = {
  /** The router's pattern, such as `/blog/:slug` or `/docs/:*rest`. */
  pattern: string;
  page: string;
  /** The inner-most first. */
  layouts: string[];
};

const help = `
Usage: bun bake build [--outdir <dir>]

Builds the app in the working directory into dist/ (or <dir>). Run it with: bun dist/server.js

The server listens on $PORT (default 3000), or the port of app/server.ts.
`;

/** In the output folder from the start of a build: a folder with this file holds only a build. */
const buildMarker = ".bun-bake-build";

/** Empties `outdir`, which must not hold anything but a build, and marks it as a build. */
function prepareOutdir(outdir: string, cwd: string, h: Helpers) {
  const fromOutdir = path.relative(outdir, cwd);
  if (fromOutdir === "" || (!fromOutdir.startsWith("..") && !path.isAbsolute(fromOutdir))) {
    throw new h.BakeError(`--outdir "${outdir}" holds the project. Pick another --outdir.`, false);
  }
  const stat = fs.statSync(outdir, { throwIfNoEntry: false });
  if (stat !== undefined) {
    if (!stat.isDirectory()) throw new h.BakeError(`--outdir "${h.display(outdir)}" is not a folder.`, false);
    const names: string[] = fs.readdirSync(outdir);
    if (names.length > 0 && !names.includes(buildMarker)) {
      throw new h.BakeError(
        `"${h.display(outdir)}" is not empty and is not a build: it has no ${buildMarker} file. Move it, or pick another --outdir.`,
        false,
      );
    }
    fs.rmSync(outdir, { recursive: true, force: true });
  }
  fs.mkdirSync(outdir, { recursive: true });
  fs.writeFileSync(path.join(outdir, buildMarker), "");
}

/** The pages of a router of a framework, from its files. */
function pagesOfRouter(router: any, h: Helpers): FrameworkPage[] {
  let scanned: { toJSON(): RouteNode };
  try {
    scanned = new FrameworkRouter({
      root: router.root,
      style: router.style,
      extensions: router.extensions,
      ignoreUnderscores: router.ignoreUnderscores,
      ignoreDirs: router.ignoreDirs,
      layouts: router.layouts,
    });
  } catch (error) {
    if (!(error instanceof AggregateError)) throw error;
    throw new h.BakeError(error.errors.map(each => each.message).join("\n"), false);
  }
  const pages: FrameworkPage[] = [];
  const walk = (node: RouteNode, prefix: string, outerLayouts: string[]) => {
    const pattern = node.part === "/" ? prefix : prefix + node.part;
    const layouts = node.layout ? [...outerLayouts, node.layout] : outerLayouts;
    const { page } = node;
    if (page) pages.push({ pattern: pattern || "/", page, layouts: ArrayPrototypeToReversed.$call(layouts) });
    for (const child of node.children) walk(child, pattern, layouts);
  };
  walk(scanned.toJSON(), "", []);
  return pages;
}

/** A path as browsers send it: non-ASCII characters and spaces are encoded, `&` and `=` are not. */
function encodedPath(file: string) {
  return new URL("/" + file.replaceAll("\\", "/"), "http://localhost").pathname;
}

/**
 * The `Bun.serve()` routes of a router pattern. `:name` is the same; a catch-all `:*name` is `*`,
 * and the server gives the rest of the path as `name`; an optional catch-all `:*?name` also matches
 * without it. A route group `(name)` is not in the URL.
 */
function servePatterns(page: FrameworkPage, prefix: string, h: Helpers) {
  const base = prefix === "/" || !prefix ? "" : prefix.replace(/\/$/, "");
  const segments = page.pattern.split("/").filter(Boolean);
  let catchAll: string | null = null;
  let optional = false;
  const out: string[] = [];
  for (const segment of segments) {
    if (segment.startsWith("(") && segment.endsWith(")")) continue;
    if (segment.startsWith(":*")) {
      optional = segment.startsWith(":*?");
      catchAll = segment.slice(optional ? 3 : 2);
      break;
    }
    if (segment.startsWith(":")) {
      out.push(segment);
      continue;
    }
    // `Bun.serve` routes read `:` as a parameter and `*` as a wildcard. In a URL, `?` and `#` end
    // the path and `%` starts an escape.
    if (/[:*?#%]/.test(segment)) {
      throw new h.BakeError(
        `"${h.display(page.page)}": a page cannot have ":", "*", "?", "#" or "%" in its path. Its URL must be fixed.`,
        false,
      );
    }
    out.push(encodedPath(segment).slice(1));
  }
  const head = base + (out.length ? "/" + out.join("/") : "");
  const patterns = catchAll === null ? [head || "/"] : [head + "/*", ...(optional ? [head || "/"] : [])];
  return { patterns, catchAll, catchAllIndex: base.split("/").filter(Boolean).length + out.length };
}

/** A filter that matches exactly one of `names`. */
function exactly(names: string[]) {
  return new RegExp(`^(?:${names.map(name => RegExpEscape(name)).join("|")})$`);
}

function formatLogs(logs: readonly unknown[]) {
  return logs.map(log => String(log)).join("\n");
}

/** The plugins of `[serve.static]` in bunfig.toml, which `bun bake` builds with too. */
async function loadServeStaticPlugins(h: Helpers) {
  const names: string[] = serveStaticPlugins();
  const folder = names.pop()!;
  const plugins: unknown[] = [];
  for (const name of names) {
    const plugin = (await import(await Bun.resolve(name, folder))).default;
    if (!plugin?.name || !$isCallable(plugin.setup)) {
      throw new h.BakeError(`"${name}" of [serve.static] in bunfig.toml must default export a bundler plugin.`, false);
    }
    plugins.push(plugin);
  }
  return plugins;
}

async function build(h: Helpers) {
  const start = performance.now();
  const cwd = process.cwd();
  let outdir = path.join(cwd, "dist");
  const argv = process.argv;
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(help);
      return;
    }
    if (arg === "--outdir" && i + 1 < argv.length) outdir = path.resolve(cwd, argv[++i]);
    else if (arg.startsWith("--outdir=")) outdir = path.resolve(cwd, arg.slice("--outdir=".length));
    else throw new h.BakeError(`Unknown argument "${arg}". Run "bun bake build --help" for the usage.`, false);
  }

  const config = await h.loadConfig(cwd, "production");
  const pagesDir = path.join(cwd, "app", "pages");
  const htmlPages = h.findHtmlPages(pagesDir);
  const components = config.framework === undefined ? h.componentPages(pagesDir) : [];
  h.checkPageClashes(pagesDir, components, htmlPages);
  if (components.length > 0) h.checkReactForPages(cwd);
  const framework =
    config.framework !== undefined || components.length > 0 ? buildFramework(config.framework?.object) : undefined;
  if (framework?.serverComponents) {
    throw new h.BakeError(`"bun bake build" does not support the serverComponents option of a framework.`, false);
  }

  let appServer: string | undefined;
  try {
    appServer = Bun.resolveSync("./app/server", cwd);
  } catch (error: any) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
  }

  type Route = FrameworkPage & {
    router: any;
    index: number;
    patterns: string[];
    catchAll: string | null;
    catchAllIndex: number;
  };
  const routes: Route[] = [];
  for (const router of framework?.fileSystemRouterTypes ?? []) {
    for (const page of pagesOfRouter(router, h)) {
      routes.push({ ...page, router, index: routes.length, ...servePatterns(page, router.prefix, h) });
    }
  }
  // As in `bun bake`, a page at a fixed path comes before an optional catch-all that also matches it.
  const fixedPaths = new Set(routes.filter(route => route.catchAll === null).flatMap(route => route.patterns));
  for (const route of routes) {
    if (route.catchAll !== null) route.patterns = route.patterns.filter(pattern => !fixedPaths.has(pattern));
  }

  if (htmlPages.length === 0 && routes.length === 0 && appServer === undefined) {
    throw new h.BakeError(
      `Nothing to serve in "${cwd}". Add a page, such as app/pages/index.html, or an app/server.ts.`,
      false,
    );
  }

  prepareOutdir(outdir, cwd, h);

  // Built-in modules of the framework, such as the default framework's `bun-bake-react/server.tsx`.
  // They load from a path in the project, so that their imports (`react`) resolve from it.
  const builtIns = new Map<string, { code?: string; path?: string }>();
  for (const module of framework?.builtInModules ?? []) builtIns.set(module.import, module);
  const builtInPath = (specifier: string) => path.join(cwd, "node_modules", ".bun-bake", specifier);
  // An entry point of a framework resolves from the project, not from the generated module that
  // imports it, as in `bun bake`.
  const entryPoint = (specifier: string) =>
    !builtIns.has(specifier) && specifier.startsWith(".") ? path.resolve(cwd, specifier) : specifier;
  // The generated modules, which a plugin gives. `Bun.build()` needs the folder of an entry point.
  // Removed after the build.
  const virtualDir = path.join(outdir, ".bun-bake");
  fs.mkdirSync(virtualDir, { recursive: true });
  // Not in `virtualDir`: with `[dir]` in the names, the name of a file comes from where it is in the
  // project, which gives each `.html` page its own output and this one `<outdir>/server.js`. The
  // bundler knows it as a file of the `bun-bake` namespace: the project can have a `server.js` too.
  const serverEntry = path.join(cwd, "server.js");

  const bakePlugin: any = {
    name: "bun-bake",
    setup(build: any) {
      const browser = build.config.target === "browser";
      // The entry points: generated files, named as the outputs are.
      build.onResolve(
        { filter: new RegExp(`^${RegExpEscape(virtualDir + path.sep)}(?:route-\\d+\\.js|production-server\\.ts)$`) },
        (args: any) => ({
          path: args.path,
        }),
      );
      if (!browser) {
        build.onResolve({ filter: exactly([serverEntry]) }, (args: any) =>
          args.kind === "entry-point-build" ? { path: "server.js", namespace: "bun-bake" } : undefined,
        );
        build.onLoad({ filter: /^/, namespace: "bun-bake" }, () => ({ contents: serverCode, loader: "js" }));
      }
      build.onResolve({ filter: /^bun:bake\/(client|server)$/ }, (args: any) => ({
        path: path.join(virtualDir, args.path.slice("bun:".length).replace("/", "-") + ".js"),
      }));

      if (builtIns.size > 0) {
        build.onResolve({ filter: exactly([...builtIns.keys()]) }, (args: any) => {
          const module = builtIns.get(args.path)!;
          return { path: module.path !== undefined ? Bun.resolveSync(module.path, cwd) : builtInPath(args.path) };
        });
      }
      build.onLoad({ filter: new RegExp(`^${RegExpEscape(virtualDir + path.sep)}`) }, (args: any) => {
        const file: string = args.path;
        return { contents: generated(path.basename(file), browser), loader: path.extname(file).slice(1) };
      });
      build.onLoad({ filter: /[\\/]node_modules[\\/]\.bun-bake[\\/]/ }, (args: any) => {
        const file: string = args.path;
        const specifier = path.relative(path.join(cwd, "node_modules", ".bun-bake"), file).replaceAll("\\", "/");
        const code = builtIns.get(specifier)?.code;
        if (code === undefined) return undefined;
        return { contents: code, loader: path.extname(file).slice(1) || "js" };
      });
    },
  };

  const imports: string[] = [];
  const name = (specifier: string) => {
    imports.push(specifier);
    return `m${imports.length - 1}`;
  };

  // The browser half of a route.
  const routeOnPage = `globalThis[Symbol.for("bun:bake/route")]`;
  let serverCode = "";
  const generated = (file: string, browser: boolean): string => {
    if (file === "bake-client.js") {
      return `
        export const route = {
          page: async () => ${routeOnPage}.page,
          layouts: async () => ${routeOnPage}.layouts,
        };
        export function onServerSideReload() {}
      `;
    }
    if (file === "bake-server.js") return `export const serverManifest = {}, ssrManifest = {}, actionManifest = null;`;
    if (file === "production-server.ts") return productionServerCode();
    const route = routes[Number(/^route-(\d+)\.js$/.exec(file)![1])];
    if (!browser) return "";
    const clientEntry = JSON.stringify(entryPoint(route.router.clientEntryPoint));
    if (!route.router.clientPages) return `import ${clientEntry};`;
    const layouts = route.layouts.map((layout, i) => `import * as l${i} from ${JSON.stringify(layout)};`).join("\n");
    // `import()`, since the client entry point waits for the page at its top level. An `import`
    // runs before this module's statements, and from a shared chunk, before all of this module.
    return `
      import * as page from ${JSON.stringify(route.page)};
      ${layouts}
      ${routeOnPage} = { page, layouts: [${route.layouts.map((_, i) => `l${i}`).join(", ")}] };
      import(${clientEntry});
    `;
  };

  const plugins = [bakePlugin, ...(await loadServeStaticPlugins(h)), ...config.plugins];
  // As in `bun bake`, which sets these at src/runtime/bake/config/transpiler.rs.
  const defines = (ssr: boolean) => ({
    "process.env.NODE_ENV": '"production"',
    "import.meta.env.DEV": "false",
    "import.meta.env.PROD": "true",
    "import.meta.env.MODE": '"production"',
    "import.meta.env.SSR": String(ssr),
    "import.meta.env.STATIC": "false",
  });
  const env = serveStaticEnv();

  // The browser build.
  const clientRoutes = routes.filter(route => route.router.clientEntryPoint);
  const clientOfRoute = new Map<number, { modules: string[]; modulepreload: string[]; styles: string[] }>();
  const files: Record<string, string> = {};
  if (clientRoutes.length > 0 || htmlPages.length > 0) {
    const clientDir = path.join(outdir, "client");
    const result = await Bun.build({
      entrypoints: [
        ...clientRoutes.map(route => path.join(virtualDir, `route-${route.index}.js`)),
        ...htmlPages.map(page => page.file),
      ],
      target: "browser",
      outdir: clientDir,
      splitting: true,
      minify: true,
      metafile: true,
      publicPath: "/",
      naming: {
        entry: "_bun/[name]-[hash].[ext]",
        chunk: "_bun/[name]-[hash].[ext]",
        asset: "_bun/[name]-[hash].[ext]",
      },
      define: defines(false),
      ...(env !== undefined && { env }),
      plugins,
      // The bundler drops these exports from each file, as in `bun bake`, after the plugins load it.
      // It knows a file by its real path, which for a symlink can be outside the router's folder.
      bakeClientPageDirs: (framework?.fileSystemRouterTypes ?? [])
        .filter(router => router.clientPages)
        .flatMap(router => {
          const root = path.resolve(cwd, router.root);
          const files = routes
            .filter(route => route.router === router)
            .flatMap(route => [route.page, ...route.layouts]);
          const dirs =
            files.length > 0 ? [root, fs.realpathSync(root), ...files.map(file => fs.realpathSync(file))] : [root];
          return dirs.map(dir => ({ dir, serverExports: router.clientPages.serverExports }));
        }),
      throw: false,
    } as any);
    if (!result.success) throw new h.BakeError(`The browser build failed:\n${formatLogs(result.logs)}`, false);
    for (const output of result.outputs) {
      const url = encodedPath(path.relative(clientDir, output.path));
      files[url] = "./client" + url;
    }
    const metafile = typeof result.metafile === "string" ? JSON.parse(result.metafile) : result.metafile;
    const publicUrl = (output: string) => encodedPath(output.replace(/^\.\//, ""));
    // By real path, as the bundler reports them. Two symlinks can be one file, with one output.
    const urlsOfHtmlFile = MapGroupBy(htmlPages, page => fs.realpathSync(page.file));
    for (const [output, info] of Object.entries<any>(metafile.outputs)) {
      if (output.endsWith(".html")) {
        const pages = urlsOfHtmlFile.get(fs.realpathSync(path.resolve(cwd, info.entryPoint)));
        if (pages === undefined) throw new h.BakeError(`No page has the output "${output}" of the build.`, false);
        for (const page of pages) files[page.url] = "./client" + publicUrl(output);
        continue;
      }
      const entry = /route-(\d+)\.js$/.exec(info.entryPoint ?? "");
      if (entry === null || output.endsWith(".css")) continue;
      clientOfRoute.set(Number(entry[1]), {
        modules: [publicUrl(output)],
        modulepreload: info.imports.filter(each => each.kind === "dynamic-import").map(each => publicUrl(each.path)),
        styles: info.cssBundle ? [publicUrl(info.cssBundle)] : [],
      });
    }
  }

  // `public/` is served as it is.
  const publicDir = path.join(cwd, "public");
  if (fs.existsSync(publicDir)) {
    fs.cpSync(publicDir, path.join(outdir, "public"), { recursive: true });
    for (const relative of new Bun.Glob("**/*").scanSync({ cwd: publicDir, onlyFiles: true, dot: true })) {
      const url = encodedPath(relative);
      files[url] = "./public" + url;
    }
  }

  // The server build.
  const routeEntries = routes.map(route => {
    const server = name(entryPoint(route.router.serverEntryPoint));
    const client = clientOfRoute.get(route.index) ?? { modules: [], modulepreload: [], styles: [] };
    return `{
      patterns: ${JSON.stringify(route.patterns)},
      catchAll: ${JSON.stringify(route.catchAll)},
      catchAllIndex: ${route.catchAllIndex},
      render: ${server}.render,
      page: ${name(route.page)},
      layouts: [${route.layouts.map(layout => name(layout)).join(", ")}],
      modules: ${JSON.stringify(client.modules)},
      modulepreload: ${JSON.stringify(client.modulepreload)},
      styles: ${JSON.stringify(client.styles)},
    }`;
  });
  serverCode = `
    import { start } from ${JSON.stringify(path.join(virtualDir, "production-server.ts"))};
    ${appServer !== undefined ? `import app from ${JSON.stringify(appServer)};` : ""}
    ${imports.map((specifier, i) => `import * as m${i} from ${JSON.stringify(specifier)};`).join("\n")}
    start({
      app: ${appServer !== undefined ? "app" : "undefined"},
      frameworkRoutes: [${routeEntries.join(", ")}],
      files: ${JSON.stringify(files)},
      htmlPages: ${JSON.stringify(htmlPages.map(page => page.url))},
    });
  `;
  const result = await Bun.build({
    entrypoints: [serverEntry],
    target: "bun",
    outdir,
    // The real path: the bundler compares it with the real folder of each file for `[dir]`.
    root: fs.realpathSync(cwd),
    naming: {
      entry: "[dir]/[name].[ext]",
      chunk: "_bun/[name]-[hash].[ext]",
      asset: "_bun/[name]-[hash].[ext]",
    },
    // As in the browser build, so that the URL of an imported file is the same in the HTML.
    publicPath: "/",
    minify: { syntax: true },
    sourcemap: "linked",
    define: defines(true),
    plugins,
    throw: false,
  } as any);
  if (!result.success) throw new h.BakeError(`The server build failed:\n${formatLogs(result.logs)}`, false);

  fs.rmSync(virtualDir, { recursive: true, force: true });
  const pageCount = htmlPages.length + routes.length;
  const elapsed = (performance.now() - start).toFixed(0);
  console.log(
    `Built ${pageCount} page${pageCount === 1 ? "" : "s"} into ${h.display(outdir)}/ in ${elapsed}ms. Run it with: bun ${h.display(path.join(outdir, "server.js"))}`,
  );
}

export default { build };
