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

  --port=<NUM>
  --host=<STR>, --hostname=<STR>
  --console # print console logs from browser
  --no-console # don't print console logs from browser
`;

const serverOptionNames = ["routes", "fetch", "websocket"];

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

async function loadPages(pagesDir: string) {
  let files: string[];
  try {
    files = [...new Bun.Glob("**/*.html").scanSync({ cwd: pagesDir, onlyFiles: true })];
  } catch (error: any) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  files.sort((a, b) => a.localeCompare(b));

  const pages: { route: string; file: string; bundle: HTMLBundle }[] = [];
  for (const relative of files) {
    const file = path.join(pagesDir, relative);
    if (relative.includes("[")) {
      throw new Error(`"${display(file)}": an HTML page cannot have a [param] in its path. Its URL must be fixed.`);
    }
    pages.push({ route: routeOfPage(relative), file, bundle: (await import(file)).default });
  }
  return pages;
}

async function loadAppServer(cwd: string): Promise<{ file: string; server: AppServer } | undefined> {
  let file: string;
  try {
    file = Bun.resolveSync("./app/server", cwd);
  } catch {
    return undefined;
  }

  const server = (await import(file)).default;
  const name = display(file);
  if (server === null || typeof server !== "object") {
    throw new TypeError(`"${name}" must have a default export with "routes", "fetch" or "websocket".`);
  }
  for (const key of Object.keys(server)) {
    if (!serverOptionNames.includes(key)) {
      throw new TypeError(
        `"${name}": the default export has "${key}", but "bun bake" only uses ${serverOptionNames.map(n => `"${n}"`).join(", ")}.`,
      );
    }
  }
  if (server.fetch !== undefined && !$isCallable(server.fetch)) {
    throw $ERR_INVALID_ARG_TYPE("fetch", "function", server.fetch);
  }
  return { file, server };
}

async function start() {
  const flags = defaultServeFlags();
  // argv[1] is the entry point `bun bake` boots with.
  for (let i = 2, argvLength = argv.length; i < argvLength; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(help);
      process.exit(0);
    }
    if (!parseServeFlag(arg, flags)) {
      throw new Error(`Unknown argument "${arg}". Run "bun bake --help" for the usage.`);
    }
  }

  const cwd = process.cwd();
  const pages = await loadPages(path.join(cwd, "app", "pages"));
  const app = await loadAppServer(cwd);
  if (pages.length === 0 && app === undefined) {
    throw new Error(`Nothing to serve in "${cwd}": there are no pages in app/pages/ and no app/server.ts.`);
  }

  const routes: Record<string, unknown> = {};
  for (const page of pages) {
    routes["/" + page.route] = page.bundle;
  }
  for (const [route, value] of Object.entries(app?.server.routes ?? {})) {
    const page = pages.find(page => "/" + page.route === route);
    if (page !== undefined) {
      throw new Error(`The route "${route}" in "${display(app!.file)}" is also the page "${display(page.file)}".`);
    }
    routes[route] = value;
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

  printBannerAndHandleShortcuts({
    server,
    elapsed,
    pathname: "/",
    routes: pages.map(({ route, file }) => ({ route, file })),
  });
}

export default start;
