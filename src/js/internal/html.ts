// This is the file that loads when you pass a '.html' entry point to Bun.
// It imports the entry points and initializes a server.
import type { HTMLBundle } from "bun";
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

const env = Bun.env;

// This function is called at startup.
async function start() {
  let args: string[] = [];
  const cwd = process.cwd();
  const flags = defaultServeFlags();
  // Step 1. Resolve all HTML entry points
  for (let i = 1, argvLength = argv.length; i < argvLength; i++) {
    const arg = argv[i];

    if (!arg.endsWith(".html")) {
      const used = parseServeFlag(argv, i, flags);
      if (used > 1) i += used - 1;

      if (arg === "--help") {
        console.log(`
Bun v${Bun.version} (html)

Usage:
  bun [...html-files] [options]

Options:

  --port <NUM>
  --host <STR>, --hostname <STR>
  --console # print console logs from browser
  --no-console # don't print console logs from browser
Examples:

  bun index.html
  bun ./index.html ./about.html --port=3000
  bun index.html --host=localhost:3000
  bun index.html --hostname=localhost:3000
  bun ./*.html
  bun index.html --console

This is a small wrapper around Bun.serve() that automatically serves the HTML files you pass in without
having to manually call Bun.serve() or write the boilerplate yourself. This runs Bun's bundler on
the HTML files, their JavaScript, and CSS, and serves them up. This doesn't do anything you can't do
yourself with Bun.serve().
`);
        process.exit(0);
      }

      continue;
    }

    if (arg.includes("*") || arg.includes("**") || arg.includes("{")) {
      const glob = new Bun.Glob(arg);

      for (const file of glob.scanSync(cwd)) {
        let resolved = path.resolve(cwd, file);
        if (resolved.includes(path.sep + "node_modules" + path.sep)) {
          continue;
        }
        try {
          resolved = Bun.resolveSync(resolved, cwd);
        } catch {
          resolved = Bun.resolveSync("./" + resolved, cwd);
        }

        if (resolved.includes(path.sep + "node_modules" + path.sep)) {
          continue;
        }

        args.push(resolved);
      }
    } else {
      let resolved = arg;
      try {
        resolved = Bun.resolveSync(arg, cwd);
      } catch {
        resolved = Bun.resolveSync("./" + arg, cwd);
      }

      if (resolved.includes(path.sep + "node_modules" + path.sep)) {
        continue;
      }

      args.push(resolved);
    }

    if (args.length > 1) {
      args = [...new Set(args)];
    }
  }

  if (args.length === 0) {
    throw new Error("No HTML files found matching " + JSON.stringify(Bun.main));
  }

  args.sort((a, b) => {
    return a.localeCompare(b);
  });

  // Add cwd to find longest common path
  let needsPop = false;
  if (args.length === 1) {
    args.push(process.cwd());
    needsPop = true;
  }

  // Find longest common path prefix to use as the base path when there are
  // multiple entry points
  let longestCommonPath = args.reduce((acc, curr) => {
    if (!acc) return curr;
    let i = 0;
    while (i < acc.length && i < curr.length && acc[i] === curr[i]) i++;
    return acc.slice(0, i);
  });

  if (process.platform === "win32") {
    longestCommonPath = longestCommonPath.replaceAll("\\", "/");
  }

  if (needsPop) {
    // Remove cwd from args
    args.pop();
  }

  // Transform file paths into friendly URL paths
  // - "index.html" -> "/"
  // - "about/index.html" -> "/about"
  // - "about/foo.html" -> "/about/foo"
  // - "foo.html" -> "/foo"
  const servePaths = args.map(arg => {
    if (process.platform === "win32") {
      arg = arg.replaceAll("\\", "/");
    }
    const basename = path.basename(arg);
    const isIndexHtml = basename === "index.html";

    let servePath = arg;
    if (servePath.startsWith(longestCommonPath)) {
      servePath = servePath.slice(longestCommonPath.length);
    } else {
      let relative = path.relative(longestCommonPath, servePath);
      if (process.platform === "win32") {
        relative = relative.replaceAll("\\", "/");
      }
      if (!relative.startsWith("..")) {
        servePath = relative;
      }
    }

    if (isIndexHtml && servePath.length === 0) {
      servePath = "/";
    } else if (isIndexHtml) {
      servePath = servePath.slice(0, -"index.html".length);
    }

    if (servePath.endsWith(".html")) {
      servePath = servePath.slice(0, -".html".length);
    }

    if (servePath.endsWith("/")) {
      servePath = servePath.slice(0, -1);
    }

    if (servePath.startsWith("/")) {
      servePath = servePath.slice(1);
    }

    if (servePath === "/") servePath = "";

    return servePath;
  });

  const htmlImports = await Promise.all(
    args.map(arg => {
      return import(arg).then(m => m.default);
    }),
  );

  // If you're only providing one entry point, then match everything to it.
  // (except for assets, which have higher precedence)
  if (htmlImports.length === 1) {
    servePaths[0] = "*";
  }

  const staticRoutes = htmlImports.reduce(
    (acc, htmlImport, index) => {
      const html = htmlImport;
      const servePath = servePaths[index];

      acc["/" + servePath] = html;
      return acc;
    },
    {} as Record<string, HTMLBundle>,
  );
  const server = serveOnFreePort(
    "bun html",
    port => ({
      routes: staticRoutes,
      development:
        env.NODE_ENV !== "production"
          ? {
              console: flags.console,
              hmr: undefined,
            }
          : false,

      hostname: flags.hostname ?? "localhost",
      // `undefined` uses the default port via existing port detection code.
      port,

      fetch(_req: Request) {
        return new Response("Not found", { status: 404 });
      },
    }),
    flags.port,
  );
  const elapsed = (performance.now() - initial).toFixed(2);

  let pathnameToPrint;
  if (servePaths.length === 1) {
    pathnameToPrint = servePaths[0];
  } else {
    const indexRoute = servePaths.find(a => {
      return a === "index" || a === "" || a === "/";
    });
    pathnameToPrint = indexRoute !== undefined ? indexRoute : servePaths[0];
  }

  pathnameToPrint ||= "/";
  if (pathnameToPrint === "*") {
    pathnameToPrint = "/";
  }

  const routes =
    htmlImports.length > 1 || (servePaths[0] !== "" && servePaths[0] !== "*")
      ? servePaths.map((route, i) => ({ route, file: args[i] }))
      : [];

  printBannerAndHandleShortcuts({ server, elapsed, pathname: pathnameToPrint, routes });
}

export default start;
