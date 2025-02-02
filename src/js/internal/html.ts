import type { HTMLBundle, Server } from "bun";
const argv = process.argv;
const path = require("node:path");
const env = Bun.env;

async function start() {
  let args: string[] = [];
  const cwd = process.cwd();

  // Step 1. Resolve all HTML entry points
  for (let i = 1, argvLength = argv.length; i < argvLength; i++) {
    const arg = argv[i];
    if (!arg.endsWith(".html")) {
      continue;
    }

    if (arg.includes("*") || arg.includes("**") || arg.includes("{")) {
      const glob = new Bun.Glob(arg);

      for (const file of glob.scanSync(cwd)) {
        let resolved = path.resolve(cwd, file);
        try {
          resolved = Bun.resolveSync(resolved, cwd);
        } catch {
          resolved = Bun.resolveSync("./" + resolved, cwd);
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

      args.push(resolved);
    }

    if (args.length > 1) {
      args = [...new Set(args)];
    }
  }

  if (args.length === 0) {
    throw new Error("No HTML files found matching " + JSON.stringify(Bun.main));
  }

  // Add cwd to find longest common path
  let needsPop = false;
  if (args.length === 1) {
    args.push(process.cwd());
    needsPop = true;
  }

  // Find longest common path prefix to use as the base path when there are
  // multiple entry points
  const longestCommonPath = args.reduce((acc, curr) => {
    if (!acc) return curr;
    let i = 0;
    while (i < acc.length && i < curr.length && acc[i] === curr[i]) i++;
    return acc.slice(0, i);
  });

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
    const basename = path.basename(arg);
    const isIndexHtml = basename === "index.html";

    let servePath = arg.startsWith(longestCommonPath) ? arg.slice(longestCommonPath.length) : arg;

    if (isIndexHtml && servePath.length === 0) {
      servePath = "/";
    } else if (isIndexHtml) {
      servePath = servePath.slice(0, -"index.html".length);
    }

    if (process.platform === "win32") {
      servePath = servePath.replaceAll("\\", "/");
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
  if (htmlImports.length === 1 && servePaths[0] === "") {
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
        development: env.NODE_ENV !== "production",

        // use the default port via existing port detection code.
        // port: 3000,

        fetch(req: Request) {
          return new Response("Not found", { status: 404 });
        },
      });
      break getServer;
    } catch (error: any) {
      if (error?.code === "EADDRINUSE") {
        let defaultPort = parseInt(env.PORT || env.BUN_PORT || env.NODE_PORT || "3000", 10);
        for (let remainingTries = 5; remainingTries > 0; remainingTries--) {
          try {
            server = Bun.serve({
              static: staticRoutes,
              development: env.NODE_ENV !== "production",

              // Retry with a different port up to 4 times.
              port: defaultPort++,

              fetch(req: Request) {
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
  const elapsed = (performance.now() / 1000).toFixed(2);
  const enableANSIColors = Bun.enableANSIColors;
  function printInitialMessage(isFirst: boolean) {
    if (enableANSIColors) {
      let topLine = `\n\x1b[1;34m\x1b[5mBun\x1b[0m \x1b[1;34mv${Bun.version}\x1b[0m`;
      if (isFirst) {
        topLine += ` \x1b[2mready in\x1b[0m \x1b[1m${elapsed}\x1b[0m ms`;
      }
      console.log(topLine + "\n");
      console.log(`\x1b[1;34m➜\x1b[0m \x1b[36m${server!.url.href}\x1b[0m`);
    } else {
      let topLine = `\n  Bun v${Bun.version}`;
      if (isFirst) {
        topLine += ` ready in ${elapsed} ms`;
      }
      console.log(topLine + "\n");
      console.log(`url: ${server!.url.href}`);
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
      const key = data.toString().toLowerCase();

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
