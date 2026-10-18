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
const isRestart = $newRustFunction("bake/config/plugins.rs", "isRestart", 0);
const restartProcess = $newRustFunction("bake/config/plugins.rs", "restartProcess", 0);

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
                        defineConfig from "bun:bake". "bun bake" starts again when it changes.
  app/server.ts         Optional. Its default export holds options of Bun.serve(), as
                        for \`export default\` in \`bun app.ts\` (a Hono app works). "fetch"
                        gets the requests that no page and no route matched.

Changes to app/server.ts and the files it imports apply without a restart.

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

/**
 * A mistake that `bun bake` found in the arguments or in the files of the app. It prints as one line:
 * its stack is in Bun, not in the app. `fixable`: a change to `app/server.ts` or `bake.config.ts` can
 * fix it, so the process waits for that change instead of exiting.
 */
class BakeError extends Error {
  fixable: boolean;
  constructor(message: string, fixable: boolean) {
    super(message);
    this.fixable = fixable;
  }
}

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
      throw new BakeError(
        `"${display(file)}": a page cannot have "[", "]", ":", "*", "?", "#" or "%" in its path. Its URL must be fixed.`,
        false,
      );
    }
    const route = routeOfPage(relative);
    const other = fileOfRoute[route];
    if (other !== undefined) {
      throw new BakeError(`"${display(other)}" and "${display(file)}" are both the page "/${route}".`, false);
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
 * server loads plugins once, so a change to the file starts the process again. Each reload
 * evaluates the file again, so the text tells a change.
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
    throw new BakeError(`"${name}" must have a default export: a config object, or a function that returns one.`, true);
  }
  const keys = ObjectKeys(config);
  for (let i = 0; i < keys.length; i++) {
    if (keys[i] !== "plugins") {
      throw new BakeError(`"${name}": the config has "${keys[i]}", but "bun bake" only uses "plugins".`, true);
    }
  }
  const list = config.plugins;
  if (list === undefined) return { plugins: [], names: [], name, key };
  if (!$isArray(list)) throw new BakeError(`"${name}": "plugins" must be an array.`, true);

  const plugins: unknown[] = [];
  const names: string[] = [];
  for (let i = 0, length = list.length; i < length; i++) {
    const plugin = list[i];
    // A function with `name` and `setup` is a plugin too, as in `Bun.build()`.
    if (plugin === null || (typeof plugin !== "object" && typeof plugin !== "function")) {
      throw new BakeError(`"${name}": plugins[${i}] is not a plugin object.`, true);
    }
    const pluginName = plugin.name;
    if (typeof pluginName !== "string" || pluginName === "") {
      throw new BakeError(`"${name}": plugins[${i}] has no "name".`, true);
    }
    if (!$isCallable(plugin.setup)) {
      throw new BakeError(
        `"${name}": the plugin "${pluginName}" has no setup() function. "bun bake" takes Bun plugins.`,
        true,
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
    throw new BakeError(`"${name}" must have a default export with "routes", "fetch" or "websocket".`, true);
  }
  // Read once each: a getter may return a new value on each read.
  const { fetch, websocket } = server;
  if (fetch !== undefined && !$isCallable(fetch)) {
    throw new BakeError(`"${name}": "fetch" must be a function.`, true);
  }
  // As in `Bun.serve()`, a `routes` array is not a route table: a Hono app has one.
  let routes = server.routes;
  if (routes === undefined) routes = server.static;
  if ($isArray(routes)) routes = undefined;
  if (routes !== undefined && (routes === null || typeof routes !== "object")) {
    throw new BakeError(`"${name}": "routes" must be an object.`, true);
  }
  if (websocket !== undefined && (websocket === null || typeof websocket !== "object")) {
    throw new BakeError(`"${name}": "websocket" must be an object.`, true);
  }
  return { file, server, routes, fetch };
}

/** How many times `start()` ran: once, then once more for each reload. */
let runs = 0;
/**
 * Whether this process is a restart of `bun bake --check`: a new process that a change started, not
 * the first start. An error at its start waits for a fix instead of exiting, since the session goes
 * on and the type checker watches the project. A restart for a change to `bake.config.ts` counts as
 * a first start.
 */
let restarted = false;

async function start() {
  if (++runs === 1) restarted = isRestart();
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
    } catch (error: any) {
      throw new BakeError(error.message, false);
    }
    if (used === 0) throw new BakeError(`Unknown argument "${arg}". Run "bun bake --help" for the usage.`, false);
    i += used;
  }

  const cwd = process.cwd();
  const config = await loadConfig(cwd);
  if (configKeyInServer !== undefined && config.key !== configKeyInServer) {
    // Does not return: on a failure it prints the error and exits.
    restartProcess();
  }
  // Before `Bun.serve()`: the server loads them with the plugins of bunfig.toml.
  setConfigPlugins(config.plugins, config.names);
  const pages = await loadPages(path.join(cwd, "app", "pages"));
  const app = await loadAppServer(cwd);
  if (pages.length === 0 && app === undefined) {
    throw new BakeError(
      `Nothing to serve in "${cwd}". Add a page, such as app/pages/index.html, or an app/server.ts.`,
      false,
    );
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
        throw new BakeError(
          `The route "${route}" in "${display(app!.file)}" is also the page "${display(page.file)}".`,
          true,
        );
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
    // Cannot listen at an address that the export of `app/server.ts` did not give (a flag, `PORT`,
    // or the default): no change to a file fixes it. Any other error comes from the export, which
    // an edit can fix.
    // The export's only when no flag set any part of it.
    const addressFromExport =
      useUnix ||
      (flags.port === undefined &&
        flags.hostname === undefined &&
        (exportedPort !== undefined || exportedHostname !== undefined));
    if (error?.syscall === "listen" && !addressFromExport) throw new BakeError(error.message, false);
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

/** `bun bake`. Prints a `BakeError` as one line, then exits or waits for a change. */
async function main() {
  try {
    await start();
  } catch (error) {
    if (!(error instanceof BakeError)) throw error;
    console.error(`error: ${error.message}`);
    // `--check` starts the process again on a change: a restart is a first run here too, but the
    // session goes on. On a reload, the server is up and keeps serving until the next change.
    if (!error.fixable && runs === 1 && !restarted) process.exit(1);
  }
}

export default main;
