// `bun bake build`: builds the app in the working directory into `dist/`, for `bun dist/server.js`.
//
// Two `Bun.build()` runs:
// - The browser build: one entry per page of a framework router with `clientPages`. Each loads the
//   page and its layouts, then the framework's client entry point, which reads them from
//   `route` of `bun:bake/client`, as in `bun bake`.
// - The server build: `dist/server.js`, which imports `app/server.ts`, the `.html` pages, the
//   framework's server entry points and the pages, and starts the server of
//   `src/runtime/bake/production/server.ts`.
const path = require("node:path");
const fs = require("node:fs");

const pagesFramework = $newRustFunction("bake/config/plugins.rs", "pagesFramework", 0);
const serveStaticEnv = $newRustFunction("bake/config/plugins.rs", "serveStaticEnv", 0);
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

/** The pages of a router of a framework, from its files. */
function pagesOfRouter(router: any): FrameworkPage[] {
  const scanned = new FrameworkRouter({
    root: router.root,
    style: router.style,
    extensions: router.extensions,
    ignoreUnderscores: router.ignoreUnderscores,
    ignoreDirs: router.ignoreDirs,
    layouts: router.layouts,
  });
  const pages: FrameworkPage[] = [];
  const walk = (node: RouteNode, prefix: string, outerLayouts: string[]) => {
    const pattern = node.part === "/" ? prefix : prefix + node.part;
    const layouts = node.layout ? [...outerLayouts, node.layout] : outerLayouts;
    if (node.page) pages.push({ pattern: pattern || "/", page: node.page, layouts: layouts.toReversed() });
    for (const child of node.children) walk(child, pattern, layouts);
  };
  walk(scanned.toJSON(), "", []);
  return pages;
}

/**
 * The `Bun.serve()` routes of a router pattern. `:name` is the same; a catch-all `:*name` is `*`,
 * and the server gives the rest of the path as `name`; an optional catch-all `:*?name` also matches
 * without it.
 */
function servePatterns(pattern: string, prefix: string) {
  const base = prefix === "/" || !prefix ? "" : prefix.replace(/\/$/, "");
  const segments = pattern.split("/").filter(Boolean);
  let catchAll: string | null = null;
  let optional = false;
  const out: string[] = [];
  for (const segment of segments) {
    if (segment.startsWith(":*")) {
      optional = segment.startsWith(":*?");
      catchAll = segment.slice(optional ? 3 : 2);
      break;
    }
    out.push(segment.startsWith(":") ? segment : encodeURIComponent(segment));
  }
  const head = base + (out.length ? "/" + out.join("/") : "");
  const patterns = catchAll === null ? [head || "/"] : [head + "/*", ...(optional ? [head || "/"] : [])];
  return { patterns, catchAll, catchAllIndex: base.split("/").filter(Boolean).length + out.length };
}

/** A filter that matches exactly one of `names`. */
function exactly(names: string[]) {
  return new RegExp(`^(?:${names.map(name => RegExp.escape(name)).join("|")})$`);
}

function formatLogs(logs: readonly unknown[]) {
  return logs.map(log => String(log)).join("\n");
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
  // Removed before each build, so it must hold only a build.
  if (fs.existsSync(outdir)) {
    if (fs.readdirSync(outdir).some(name => name !== ".bun-bake") && !fs.existsSync(path.join(outdir, "server.js"))) {
      throw new h.BakeError(
        `"${h.display(outdir)}" is not empty and has no server.js. Move it, or pick another --outdir.`,
        false,
      );
    }
    fs.rmSync(outdir, { recursive: true, force: true });
  }

  const config = await h.loadConfig(cwd, "production");
  const pagesDir = path.join(cwd, "app", "pages");
  const htmlPages = h.findHtmlPages(pagesDir);
  const components = config.framework === undefined ? h.componentPages(pagesDir) : [];
  h.checkPageClashes(pagesDir, components, htmlPages);
  if (components.length > 0) h.checkReactForPages(cwd);
  const framework = config.framework?.object ?? (components.length > 0 ? pagesFramework() : undefined);

  let appServer: string | undefined;
  try {
    appServer = Bun.resolveSync("./app/server", cwd);
  } catch (error: any) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
  }

  // Built-in modules of the framework, such as the default framework's `bun-bake-react/server.tsx`.
  // They load from a path in the project, so that their imports (`react`) resolve from it.
  const builtIns = new Map<string, { code?: string; path?: string }>();
  for (const module of framework?.builtInModules ?? []) builtIns.set(module.import, module);
  const builtInPath = (specifier: string) => path.join(cwd, "node_modules", ".bun-bake", specifier);
  // The generated modules, which a plugin gives. `Bun.build()` needs the folder of an entry point.
  // Removed after the build.
  const virtualDir = path.join(outdir, ".bun-bake");
  fs.mkdirSync(virtualDir, { recursive: true });

  type Route = FrameworkPage & {
    router: any;
    index: number;
    patterns: string[];
    catchAll: string | null;
    catchAllIndex: number;
  };
  const routes: Route[] = [];
  for (const router of framework?.fileSystemRouterTypes ?? []) {
    for (const page of pagesOfRouter(router)) {
      routes.push({ ...page, router, index: routes.length, ...servePatterns(page.pattern, router.prefix) });
    }
  }

  // Each file under a `clientPages` router loses its router's server exports in the browser.
  const strippers: { dir: string; transpilers: Map<string, any> }[] = [];
  for (const router of framework?.fileSystemRouterTypes ?? []) {
    const serverExports = router.clientPages?.serverExports;
    if (!serverExports?.length) continue;
    strippers.push({ dir: path.resolve(cwd, router.root) + path.sep, transpilers: new Map() });
    const transpilers = strippers[strippers.length - 1].transpilers;
    for (const loader of ["ts", "tsx", "js", "jsx"]) {
      transpilers.set(
        loader,
        new Bun.Transpiler({
          loader,
          exports: { eliminate: serverExports },
          trimUnusedImports: true,
          tsconfig: { compilerOptions: { jsx: "react-jsx" } },
        }),
      );
    }
  }

  const routeKey = Symbol.for("bun:bake/route").description!;
  const bakePlugin: any = {
    name: "bun-bake",
    setup(build: any) {
      const browser = build.config.target === "browser";
      // The entry points: generated files, named as the outputs are.
      build.onResolve(
        {
          filter: new RegExp(
            `^${RegExp.escape(virtualDir + path.sep)}(?:route-\\d+\\.js|server\\.js|production-server\\.ts)$`,
          ),
        },
        (args: any) => ({
          path: args.path,
        }),
      );
      build.onResolve({ filter: /^bun:bake\/(client|server)$/ }, (args: any) => ({
        path: path.join(virtualDir, args.path.slice("bun:".length).replace("/", "-") + ".js"),
      }));

      if (builtIns.size > 0) {
        build.onResolve({ filter: exactly([...builtIns.keys()]) }, (args: any) => {
          const module = builtIns.get(args.path)!;
          return { path: module.path !== undefined ? path.resolve(cwd, module.path) : builtInPath(args.path) };
        });
      }
      build.onLoad({ filter: new RegExp(`^${RegExp.escape(virtualDir + path.sep)}`) }, (args: any) => {
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
      if (browser && strippers.length > 0) {
        const underRouters = new RegExp(`^(?:${strippers.map(s => RegExp.escape(s.dir)).join("|")}).*\\.[jt]sx?$`);
        build.onLoad({ filter: underRouters }, async (args: any) => {
          const file: string = args.path;
          const stripper = strippers.find(s => file.startsWith(s.dir));
          if (stripper === undefined || file.includes(`${path.sep}node_modules${path.sep}`)) return undefined;
          const loader = path.extname(file).slice(1);
          const code = await Bun.file(file).text();
          return { contents: stripper.transpilers.get(loader).transformSync(code), loader: "js" };
        });
      }
    },
  };

  const imports: string[] = [];
  const name = (specifier: string) => {
    imports.push(specifier);
    return `m${imports.length - 1}`;
  };

  // The browser half of a route.
  let serverEntry = "";
  const generated = (file: string, browser: boolean): string => {
    if (file === "bake-client.js") {
      // A page loads after this module: `route` waits for it.
      return `
        const ready = (globalThis[Symbol.for(${JSON.stringify(routeKey)})] ??= Promise.withResolvers());
        export const route = {
          page: () => ready.promise.then(route => route.page),
          layouts: () => ready.promise.then(route => route.layouts),
        };
        export function onServerSideReload() {}
      `;
    }
    if (file === "bake-server.js") return `export const serverManifest = {}, ssrManifest = {}, actionManifest = null;`;
    if (file === "production-server.ts") return productionServerCode();
    if (file === "server.js") return serverEntry;
    const route = routes[Number(/^route-(\d+)\.js$/.exec(file)![1])];
    if (!browser) return "";
    const layouts = route.layouts.map((layout, i) => `import * as l${i} from ${JSON.stringify(layout)};`).join("\n");
    return `
      import * as page from ${JSON.stringify(route.page)};
      ${layouts}
      (globalThis[Symbol.for(${JSON.stringify(routeKey)})] ??= Promise.withResolvers()).resolve({
        page,
        layouts: [${route.layouts.map((_, i) => `l${i}`).join(", ")}],
      });
      import ${JSON.stringify(route.router.clientEntryPoint)};
    `;
  };

  const plugins = [bakePlugin, ...config.plugins];
  const define = { "process.env.NODE_ENV": '"production"' };

  // The browser build.
  const clientRoutes = routes.filter(route => route.router.clientPages && route.router.clientEntryPoint);
  const clientOfRoute = new Map<number, { modules: string[]; styles: string[] }>();
  const files: Record<string, string> = {};
  if (clientRoutes.length > 0) {
    const env = serveStaticEnv();
    const result = await Bun.build({
      entrypoints: clientRoutes.map(route => path.join(virtualDir, `route-${route.index}.js`)),
      target: "browser",
      outdir: path.join(outdir, "client"),
      splitting: true,
      minify: true,
      metafile: true,
      publicPath: "/",
      naming: {
        entry: "_bun/[name]-[hash].[ext]",
        chunk: "_bun/[name]-[hash].[ext]",
        asset: "_bun/[name]-[hash].[ext]",
      },
      define,
      ...(env !== undefined && { env }),
      plugins,
      throw: false,
    } as any);
    if (!result.success) throw new h.BakeError(`The browser build failed:\n${formatLogs(result.logs)}`, false);
    const metafile = typeof result.metafile === "string" ? JSON.parse(result.metafile) : result.metafile;
    for (const [output, info] of Object.entries<any>(metafile.outputs)) {
      const url = "/" + output.replace(/^\.\//, "");
      files[url] = "./client" + url;
      const entry = /route-(\d+)\.js$/.exec(info.entryPoint ?? "");
      if (entry === null || output.endsWith(".css")) continue;
      clientOfRoute.set(Number(entry[1]), {
        modules: [url],
        styles: info.cssBundle ? ["/" + info.cssBundle.replace(/^\.\//, "")] : [],
      });
    }
  }

  // `public/` is served as it is.
  const publicDir = path.join(cwd, "public");
  if (fs.existsSync(publicDir)) {
    fs.cpSync(publicDir, path.join(outdir, "public"), { recursive: true });
    for (const relative of new Bun.Glob("**/*").scanSync({ cwd: publicDir, onlyFiles: true, dot: false })) {
      const url = new URL("/" + relative.replaceAll("\\", "/"), "http://localhost").pathname;
      files[url] = "./public" + url;
    }
  }

  // The server build.
  const appName = appServer !== undefined ? name(appServer) : undefined;
  const htmlNames = htmlPages.map(page => name(page.file));
  const routeEntries = routes.map(route => {
    const server = name(route.router.serverEntryPoint);
    const client = clientOfRoute.get(route.index) ?? { modules: [], styles: [] };
    return `{
      patterns: ${JSON.stringify(route.patterns)},
      catchAll: ${JSON.stringify(route.catchAll)},
      catchAllIndex: ${route.catchAllIndex},
      render: ${server}.render,
      page: ${name(route.page)},
      layouts: [${route.layouts.map(layout => name(layout)).join(", ")}],
      modules: ${JSON.stringify(client.modules)},
      styles: ${JSON.stringify(client.styles)},
    }`;
  });
  const htmlNamesSet = new Set(htmlNames);
  serverEntry = `
    import { start } from ${JSON.stringify(path.join(virtualDir, "production-server.ts"))};
    ${imports.map((specifier, i) => (htmlNamesSet.has(`m${i}`) ? `import m${i} from ${JSON.stringify(specifier)};` : `import * as m${i} from ${JSON.stringify(specifier)};`)).join("\n")}
    start({
      app: ${appName !== undefined ? `${appName}.default` : "undefined"},
      htmlPages: [${htmlPages.map((page, i) => `{ url: ${JSON.stringify(page.url)}, bundle: ${htmlNames[i]} }`).join(", ")}],
      frameworkRoutes: [${routeEntries.join(", ")}],
      files: ${JSON.stringify(files)},
    });
  `;
  const result = await Bun.build({
    entrypoints: [path.join(virtualDir, "server.js")],
    target: "bun",
    outdir,
    naming: { entry: "[name].[ext]", chunk: "_bun/[name]-[hash].[ext]", asset: "_bun/[name]-[hash].[ext]" },
    minify: { syntax: true },
    sourcemap: "linked",
    define,
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
