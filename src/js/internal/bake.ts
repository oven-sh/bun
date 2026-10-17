// This is the file that loads for `bun bake`, when the project has no `bake` script or file of its own.
// It serves the app in the working directory: the pages in `app/pages/` and the server in `app/server.*`.
import type { HTMLBundle, Serve } from "bun";
const initial = performance.now();
const argv = process.argv;

// `import` cannot be used in this file and only Bun builtin modules can be used.
const path = require("node:path");
const {
  defaultServeFlags,
  parseServeFlag,
  serveOnFreePort,
  printBannerAndHandleShortcuts,
} = require("internal/serve_cli");

// `app/server.ts` runs before the code that checks its export, and can change these on the prototypes.
const ObjectKeys = Object.keys;

const help = `
Bun v${Bun.version} (bake)

Usage:
  bun bake [options]

Serves the app in the working directory, with hot reloading:

  app/pages/**/*.html   Pages. The path is the URL: app/pages/docs/index.html is /docs.
  app/server.ts         Optional. Its default export may have "routes", "fetch" and
                        "websocket", as in Bun.serve(). "fetch" gets the requests that
                        no page and no route matched.

Options:

  --port <NUM>
  --host <STR>, --hostname <STR>
  --console # print console logs from browser
  --no-console # don't print console logs from browser
  --check # type check the project first, and do not serve it if it has errors
`;

type Page = {
  /** The URL path, without the leading `/`, as the file names it. */
  route: string;
  /** The `Bun.serve` route: `/` and `route` with each segment percent-encoded, as browsers send it. */
  url: string;
  file: string;
  bundle: HTMLBundle;
};

type AppServer = {
  routes?: Record<string, unknown>;
  fetch?: (req: Request, server: unknown) => unknown;
  websocket?: unknown;
};

/** `file` relative to the working directory, with `/` on every platform, for messages. */
function display(file: string): string {
  return path.relative(process.cwd(), file).replaceAll("\\", "/");
}

/** The URL path of the page at `file`, relative to `app/pages/`, without the leading `/`. */
function routeOfPage(file: string): string {
  let route = file.replaceAll("\\", "/").slice(0, -".html".length);
  if (route === "index") return "";
  if (route.endsWith("/index")) route = route.slice(0, -"/index".length);
  return route;
}

async function loadPages(pagesDir: string): Promise<Page[]> {
  let files: string[];
  try {
    files = [...new Bun.Glob("**/*.html").scanSync({ cwd: pagesDir, onlyFiles: true, followSymlinks: true })];
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  files.sort((a, b) => a.localeCompare(b));

  const pages: Page[] = [];
  const fileOfRoute: Record<string, string> = { __proto__: null } as any;
  for (const relative of files) {
    const file = path.join(pagesDir, relative);
    // `Bun.serve` routes read `:` as a parameter and `*` as a wildcard. `[` is the parameter syntax of page files.
    // In a URL, `?` and `#` end the path and `%` starts an escape.
    if (/[[\]:*?#%]/.test(relative)) {
      throw new Error(
        `"${display(file)}": a page cannot have "[", "]", ":", "*", "?", "#" or "%" in its path. Its URL must be fixed.`,
      );
    }
    const route = routeOfPage(relative);
    const other = fileOfRoute[route];
    if (other !== undefined) {
      throw new Error(`"${display(other)}" and "${display(file)}" are both the page "/${route}".`);
    }
    fileOfRoute[route] = file;
    // Encoded as browsers send it: non-ASCII characters and spaces are, `&` and `=` are not.
    const url = new URL("/" + route, "http://localhost").pathname;
    pages.push({ route, url, file, bundle: (await import(file)).default });
  }
  return pages;
}

async function loadAppServer(cwd: string): Promise<{ file: string; server: AppServer } | undefined> {
  let file: string;
  try {
    file = Bun.resolveSync("./app/server", cwd);
  } catch (error: any) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") return undefined;
    throw error;
  }

  const server = (await import(file)).default;
  const name = display(file);
  if (server === null || typeof server !== "object") {
    throw new TypeError(`"${name}" must have a default export with "routes", "fetch" or "websocket".`);
  }
  const keys = ObjectKeys(server);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (key !== "routes" && key !== "fetch" && key !== "websocket") {
      throw new TypeError(
        `"${name}": the default export has "${key}", but "bun bake" only uses "routes", "fetch", "websocket".`,
      );
    }
  }
  const fetch = server.fetch;
  if (fetch !== undefined && !$isCallable(fetch)) {
    throw $ERR_INVALID_ARG_TYPE("fetch", "function", fetch);
  }
  const { routes, websocket } = server;
  if (routes !== undefined && (routes === null || typeof routes !== "object")) {
    throw $ERR_INVALID_ARG_TYPE("routes", "object", routes);
  }
  if (websocket !== undefined && (websocket === null || typeof websocket !== "object")) {
    throw $ERR_INVALID_ARG_TYPE("websocket", "object", websocket);
  }
  return { file, server: { routes, fetch, websocket } };
}

async function start() {
  const flags = defaultServeFlags();
  // argv[1] is the entry point `bun bake` boots with.
  for (let i = 2, argvLength = argv.length; i < argvLength;) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(help);
      process.exit(0);
    }
    const used = parseServeFlag(argv, i, flags);
    if (used === 0) {
      throw new Error(`Unknown argument "${arg}". Run "bun bake --help" for the usage.`);
    }
    i += used;
  }

  const cwd = process.cwd();
  const pages = await loadPages(path.join(cwd, "app", "pages"));
  const app = await loadAppServer(cwd);
  if (pages.length === 0 && app === undefined) {
    throw new Error(`Nothing to serve in "${cwd}": there are no pages in app/pages/ and no app/server.ts.`);
  }

  const routes: Record<string, unknown> = {};
  const pageOfRoute: Record<string, Page> = { __proto__: null } as any;
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    routes[page.url] = page.bundle;
    pageOfRoute[page.url] = page;
  }
  const appRoutes = app?.server.routes;
  if (appRoutes !== undefined) {
    const names = ObjectKeys(appRoutes);
    for (let i = 0; i < names.length; i++) {
      const route = names[i];
      const page = pageOfRoute[route];
      if (page !== undefined) {
        throw new Error(`The route "${route}" in "${display(app!.file)}" is also the page "${display(page.file)}".`);
      }
      routes[route] = appRoutes[route];
    }
  }

  const fetch = app?.server.fetch ?? (() => new Response("Not found", { status: 404 }));
  const server = serveOnFreePort(
    port =>
      ({
        routes,
        fetch,
        websocket: app?.server.websocket,
        development: { console: flags.console, hmr: undefined },
        hostname: flags.hostname,
        // `undefined` uses the default port via existing port detection code.
        port,
      }) as Serve.Options<undefined>,
    flags.port,
  );
  const elapsed = (performance.now() - initial).toFixed(2);

  const listed: { route: string; file: string }[] = [];
  for (let i = 0; i < pages.length; i++) {
    listed[i] = { route: pages[i].route, file: pages[i].file };
  }
  printBannerAndHandleShortcuts({ server, elapsed, pathname: "/", routes: listed });
}

export default start;
