// This is the file that loads when you pass a '.html' entry point to Bun.
// It imports the entry points and initializes a server.
import type { HTMLBundle, Server } from "bun";
const initial = performance.now();
const argv = process.argv;

// `import` cannot be used in this file and only Bun builtin modules can be used.
const path = require("node:path");

const env = Bun.env;

// This function is called at startup.
async function start() {
  let args: string[] = [];
  const cwd = process.cwd();
  let hostname = "localhost";
  let port: number | undefined = undefined;
  let enableConsoleLog = false;
  // Step 1. Resolve all HTML entry points
  for (let i = 1, argvLength = argv.length; i < argvLength; i++) {
    const arg = argv[i];

    if (!arg.endsWith(".html")) {
      if (arg.startsWith("--hostname=")) {
        hostname = arg.slice("--hostname=".length);
        if (hostname.includes(":")) {
          const [host, portString] = hostname.split(":");
          hostname = host;
          port = parseInt(portString, 10);
        }
      } else if (arg.startsWith("--port=")) {
        port = parseInt(arg.slice("--port=".length), 10);
      } else if (arg.startsWith("--host=")) {
        hostname = arg.slice("--host=".length);
        if (hostname.includes(":")) {
          const [host, portString] = hostname.split(":");
          hostname = host;
          port = parseInt(portString, 10);
        }
      } else if (arg === "--console") {
        enableConsoleLog = true;
      } else if (arg === "--no-console") {
        enableConsoleLog = false;
      }

      if (arg === "--help") {
        console.log(`
Bun v${Bun.version} (html)

Usage:
  bun [...html-files] [options]

Options:

  --port=<NUM>
  --host=<STR>, --hostname=<STR>
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

  if (path.platform === "win32") {
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
      const relative = path.relative(longestCommonPath, servePath);
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
  var server: Server;
  getServer: {
    try {
      server = Bun.serve({
        static: staticRoutes,
        development:
          env.NODE_ENV !== "production"
            ? {
                console: enableConsoleLog,
                hmr: undefined,
              }
            : false,

        hostname,
        port,

        // use the default port via existing port detection code.
        // port: 3000,

        fetch(_req: Request) {
          return new Response("Not found", { status: 404 });
        },
      });
      break getServer;
    } catch (error: any) {
      if (error?.code === "EADDRINUSE") {
        let defaultPort = port || parseInt(env.PORT || env.BUN_PORT || env.NODE_PORT || "3000", 10);
        for (let remainingTries = 5; remainingTries > 0; remainingTries--) {
          try {
            server = Bun.serve({
              static: staticRoutes,
              development:
                env.NODE_ENV !== "production"
                  ? {
                      console: enableConsoleLog,
                      hmr: undefined,
                    }
                  : false,

              hostname,

              // Retry with a different port up to 4 times.
              port: defaultPort++,

              fetch(_req: Request) {
                return new Response("Not found", { status: 404 });
              },
            });
            break getServer;
          } catch (error: any) {
            if (error?.code === "EADDRINUSE") {
              continue;
            }
            throw error;
          }
        }
      }

      throw error;
    }
  }
  const elapsed = (performance.now() - initial).toFixed(2);
  const enableANSIColors = Bun.enableANSIColors;
  function printInitialMessage(isFirst: boolean) {
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

    if (enableANSIColors) {
      let topLine = `${server.development ? "\x1b[34;7m DEV \x1b[0m " : ""}\x1b[1;34m\x1b[5mBun\x1b[0m \x1b[1;34mv${Bun.version}\x1b[0m`;
      if (isFirst) {
        topLine += ` \x1b[2mready in\x1b[0m \x1b[1m${elapsed}\x1b[0m ms`;
      }
      if (IS_BUN_DEVELOPMENT && process.env.BUN_DEBUG_DevServer) {
        topLine += `\x1b[2m (PID ${process.pid})\x1b[0m`;
      }
      console.log(topLine + "\n");
      console.log(`\x1b[1;34m➜\x1b[0m \x1b[36m${new URL(pathnameToPrint, server!.url)}\x1b[0m`);
    } else {
      let topLine = `Bun v${Bun.version}`;
      if (isFirst) {
        if (server.development) {
          topLine += " dev server";
        }
        topLine += ` ready in ${elapsed} ms`;
      }
      console.log(topLine + "\n");
      console.log(`url: ${new URL(pathnameToPrint, server!.url)}`);
    }
    if (htmlImports.length > 1 || (servePaths[0] !== "" && servePaths[0] !== "*")) {
      console.log("\nRoutes:");

      const pairs: { route: string; importPath: string }[] = [];

      for (let i = 0, length = servePaths.length; i < length; i++) {
        const route = servePaths[i];
        const importPath = args[i];
        pairs.push({ route, importPath });
      }
      pairs.sort((a, b) => {
        if (b.route === "") return 1;
        if (a.route === "") return -1;
        return a.route.localeCompare(b.route);
      });
      for (let i = 0, length = pairs.length; i < length; i++) {
        const { route, importPath } = pairs[i];
        const isLast = i === length - 1;
        const prefix = isLast ? "  └── " : "  ├── ";
        if (enableANSIColors) {
          console.log(`${prefix}\x1b[36m/${route}\x1b[0m \x1b[2m→ ${path.relative(process.cwd(), importPath)}\x1b[0m`);
        } else {
          console.log(`${prefix}/${route} → ${path.relative(process.cwd(), importPath)}`);
        }
      }
    }

    if (isFirst && process.stdin.isTTY) {
      if (enableANSIColors) {
        console.log();
        console.log("\x1b[2mPress \x1b[2;36mh + Enter\x1b[39;2m to show shortcuts\x1b[0m");
      } else {
        console.log();
        console.log("Press h + Enter to show shortcuts");
      }
    }
  }

  printInitialMessage(true);

  // Keyboard shortcuts
  if (process.stdin.isTTY) {
    // Handle Ctrl+C and other termination signals
    process.on("SIGINT", () => process.exit());
    process.on("SIGHUP", () => process.exit());
    process.on("SIGTERM", () => process.exit());
    process.stdin.on("data", data => {
      const key = data.toString().toLowerCase().replaceAll("\r\n", "\n");

      switch (key) {
        case "\x03": // Ctrl+C
        case "q\n":
          process.exit();
          break;

        case "c\n":
          console.clear();
          printInitialMessage(false);
          break;

        case "o\n":
          const url = server.url.toString();

          if (process.platform === "darwin") {
            // TODO: copy the AppleScript from create-react-app or Vite.
            Bun.spawn(["open", url]).exited.catch(() => {});
          } else if (process.platform === "win32") {
            Bun.spawn(["start", url]).exited.catch(() => {});
          } else {
            Bun.spawn(["xdg-open", url]).exited.catch(() => {});
          }
          break;

        case "h\n":
          console.clear();
          printInitialMessage(false);
          console.log("\n  Shortcuts\x1b[2m:\x1b[0m\n");
          console.log("  \x1b[2m→\x1b[0m   \x1b[36mc + Enter\x1b[0m   clear screen");
          console.log("  \x1b[2m→\x1b[0m   \x1b[36mo + Enter\x1b[0m   open in browser");
          console.log("  \x1b[2m→\x1b[0m   \x1b[36mq + Enter\x1b[0m   quit (or Ctrl+C)\n");
          break;
      }
    });
  }
}

export default start;
