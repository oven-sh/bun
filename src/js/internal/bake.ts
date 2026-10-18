// This is the file that loads for `bun bake`, when the project has no `bake` script or file of its own.
// It serves the app in the working directory: the pages in `app/pages/` and the server in `app/server.*`.
import type { HTMLBundle, Serve, Server } from "bun";
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
const setConfigPlugins = $newRustFunction("bake/config/plugins.rs", "setConfigPlugins", 2);
const takeRestartMark = $newRustFunction("bake/config/plugins.rs", "takeRestartMark", 0);

// `app/server.ts` runs before the code that checks its export, and can change these on the prototypes.
const ObjectKeys = Object.keys;
const ObjectCreate = Object.create;
const ObjectDefineProperty = Object.defineProperty;

const help = `
Bun v${Bun.version} (bake)

Usage:
  bun bake [options]

Serves the app in the working directory, with hot reloading:

  app/pages/**/*.html   Pages. The path is the URL: app/pages/docs/index.html is /docs.
  bake.config.ts        Optional. Build plugins, as Bun plugins:
                        export default defineConfig({ plugins: [...] }), with
                        defineConfig from "bun:bake". Restart after you change it.

Changes to app/server.ts and the files it imports apply without a restart.
  app/server.ts         Optional. Its default export holds options of Bun.serve(), as
                        for \`export default\` in \`bun app.ts\` (a Hono app works). "fetch"
                        gets the requests that no page and no route matched.

Options:

  --port <NUM>
  --host <STR>, --hostname <STR>
  --console # print console logs from browser
  --no-console # don't print console logs from browser
  --check # type check the project first, and again after each change. With errors, do not serve it
  --no-clear-screen # do not clear the terminal on a reload
`;

type Page = {
  /** The URL path, without the leading `/`, as the file names it. */
  route: string;
  /** The `Bun.serve` route: `/` and `route` with each segment percent-encoded, as browsers send it. */
  url: string;
  file: string;
  bundle: HTMLBundle;
};

/** The default export of `app/server.ts`: options of `Bun.serve()`, as for `export default` in `bun app.ts`. */
type AppServer = Record<string, any>;

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

/**
 * The `key` of the `bake.config.ts` that the server loaded its plugins from, once it started. The
 * server loads plugins once, and each reload evaluates the file again, so the text tells a change.
 */
let configKeyInServer: string | undefined;

type Config = { plugins: unknown[]; names: string[]; name: string; key: string };

/** The plugins of `bake.config.ts`: its default export is a config, or a function that returns one. */
async function loadConfig(cwd: string): Promise<Config> {
  let file: string;
  try {
    file = Bun.resolveSync("./bake.config", cwd);
  } catch (error: any) {
    if (error?.code === "ERR_MODULE_NOT_FOUND") return { plugins: [], names: [], name: "bake.config.ts", key: "" };
    throw error;
  }

  const name = display(file);
  const key = file + "\0" + Bun.hash(await Bun.file(file).bytes());
  // A promise, a function, or a function that returns a promise: each gives the config.
  let config = await (await import(file)).default;
  if ($isCallable(config)) config = await config({ mode: "development" });
  if (config === null || typeof config !== "object") {
    throw new TypeError(`"${name}" must have a default export: a config object, or a function that returns one.`);
  }
  const keys = ObjectKeys(config);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] !== "plugins") {
      throw new TypeError(`"${name}": the config has "${keys[i]}", but "bun bake" only uses "plugins".`);
    }
  }
  const list = config.plugins;
  if (list === undefined) return { plugins: [], names: [], name, key };
  if (!$isArray(list)) throw $ERR_INVALID_ARG_TYPE("plugins", "array", list);

  const plugins: unknown[] = [];
  const names: string[] = [];
  for (let i = 0, length = list.length; i < length; i++) {
    const plugin = list[i];
    // A function with `name` and `setup` is a plugin too, as in `Bun.build()`.
    if (plugin === null || (typeof plugin !== "object" && typeof plugin !== "function")) {
      throw new TypeError(`"${name}": plugins[${i}] is not a plugin object.`);
    }
    const pluginName = plugin.name;
    if (typeof pluginName !== "string" || pluginName === "") {
      throw new TypeError(`"${name}": plugins[${i}] has no "name".`);
    }
    if (!$isCallable(plugin.setup)) {
      throw new TypeError(
        `"${name}": the plugin "${pluginName}" has no setup() function. "bun bake" takes Bun plugins.`,
      );
    }
    plugins.push(plugin);
    names.push(pluginName);
  }
  return { plugins, names, name, key };
}

async function loadAppServer(
  cwd: string,
): Promise<
  { file: string; server: AppServer; routes: Record<string, unknown> | undefined; fetch: unknown } | undefined
> {
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
  // Read once each: a getter may return a new value on each read.
  const { fetch, websocket } = server;
  if (fetch !== undefined && !$isCallable(fetch)) {
    throw $ERR_INVALID_ARG_TYPE("fetch", "function", fetch);
  }
  // As in `Bun.serve()`, a `routes` array is not a route table: a Hono app has one.
  let routes = server.routes;
  if (routes === undefined) routes = server.static;
  if ($isArray(routes)) routes = undefined;
  if (routes !== undefined && (routes === null || typeof routes !== "object")) {
    throw $ERR_INVALID_ARG_TYPE("routes", "object", routes);
  }
  if (websocket !== undefined && (websocket === null || typeof websocket !== "object")) {
    throw $ERR_INVALID_ARG_TYPE("websocket", "object", websocket);
  }
  return { file, server, routes, fetch };
}

/** How many times `start()` ran: once, then once more for each reload. */
let runs = 0;
/** Whether this process is `bun bake --check` started again after a change. */
let restarted = false;

/**
 * At the start, prints the message of `error` and exits: it comes from a file that `bun bake` does
 * not load, so no change to a file reloads it. An error that a change to `app/server.ts` or
 * `bake.config.ts` can fix is thrown instead: the process waits for that change and reloads. On a
 * reload, the server is up: throw, so it keeps serving until the next change.
 */
function exitWith(error: any): never {
  // `--check` starts the process again on a change: a restart is a first run here too, but the
  // session goes on.
  if (runs > 1 || restarted) throw $isObject(error) ? error : new Error(error);
  exitForArguments(error);
}

/** Prints the message of `error` and exits: a change to a file does not change the arguments. */
function exitForArguments(error: any): never {
  console.error(`error: ${error?.message ?? error}`);
  process.exit(1);
}

async function start() {
  if (++runs === 1) restarted = takeRestartMark();
  const flags = defaultServeFlags();
  // There is no entry module, so the arguments start at argv[1], as for `bun -e`.
  for (let i = 1, argvLength = argv.length; i < argvLength;) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      console.log(help);
      process.exit(0);
    }
    let used: number;
    try {
      used = parseServeFlag(argv, i, flags);
    } catch (error) {
      exitForArguments(error);
    }
    if (used === 0) exitForArguments(`Unknown argument "${arg}". Run "bun bake --help" for the usage.`);
    i += used;
  }

  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  if (configKeyInServer !== undefined && config.key !== configKeyInServer) {
    console.warn(`"${config.name}" changed. Restart "bun bake" to use the new plugins.`);
  }
  // Before `Bun.serve()`: the server loads them with the plugins of bunfig.toml.
  setConfigPlugins(config.plugins, config.names);
  const pages = await loadPages(path.join(cwd, "app", "pages")).catch(exitWith);
  const app = await loadAppServer(cwd);
  if (pages.length === 0 && app === undefined) {
    exitWith(`Nothing to serve in "${cwd}": there are no pages in app/pages/ and no app/server.ts.`);
  }

  const routes: Record<string, unknown> = {};
  const pageOfRoute: Record<string, Page> = { __proto__: null } as any;
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    routes[page.url] = page.bundle;
    pageOfRoute[page.url] = page;
  }
  const appRoutes = app?.routes;
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

  const fetch = app?.fetch ?? (() => new Response("Not found", { status: 404 }));
  // Like `export default` in `bun app.ts`, every option of `Bun.serve()` in the export counts. These
  // are Bake's, and the flags come before the export's own `port` and `hostname`.
  const exported = app?.server;
  // Each is read once: a getter may return a new value on each read.
  // `host` is an alias of `hostname` in `Bun.serve()`.
  // An empty one is no hostname: `Bun.serve()` would listen on every interface.
  const exportedHostname = (exported?.hostname ?? exported?.host) || undefined;
  const exportedPort = exported?.port;
  // A `unix` socket in the export is kept unless a flag asks for a TCP address.
  const useUnix = exported?.unix !== undefined && flags.hostname === undefined && flags.port === undefined;
  let server: Server<undefined>;
  try {
    server = serveOnFreePort(
      "bun bake",
      port => {
        const options = ObjectCreate(exported ?? null);
        // Own properties, defined rather than assigned: the export may be frozen, or have getters.
        const own = (key: string, value: unknown) =>
          ObjectDefineProperty(options, key, { value, writable: true, enumerable: true, configurable: true });
        own("routes", routes);
        own("fetch", fetch);
        own("development", { console: flags.console, hmr: undefined });
        if (useUnix) {
          own("hostname", undefined);
          own("host", undefined);
          own("port", undefined);
        } else {
          own("unix", undefined);
          own("hostname", flags.hostname ?? exportedHostname ?? "localhost");
          // `undefined` uses the default port via existing port detection code.
          own("port", port);
        }
        return options as Serve.Options<undefined>;
      },
      useUnix ? undefined : (flags.port ?? exportedPort),
    );
  } catch (error: any) {
    // Cannot listen where `--port` or `--host` says: no change to a file fixes it. Any other error
    // comes from the options of `app/server.ts`, which an edit can fix.
    if (error?.syscall === "listen" && (flags.port !== undefined || flags.hostname !== undefined)) {
      exitWith(error);
    }
    throw error;
  }
  configKeyInServer ??= config.key;
  const elapsed = (performance.now() - initial).toFixed(2);

  const listed: { route: string; file: string }[] = [];
  for (let i = 0; i < pages.length; i++) {
    listed[i] = { route: pages[i].route, file: pages[i].file };
  }
  printBannerAndHandleShortcuts({ server, elapsed, pathname: "/", routes: listed });
}

export default start;
