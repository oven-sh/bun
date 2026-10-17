// The parts of `bun ./index.html` (internal/html.ts) and `bun bake` (internal/bake.ts) that start
// the server and talk to the terminal.
import type { Serve, Server } from "bun";

const path = require("node:path");

const env = Bun.env;

type ServeFlags = {
  hostname: string;
  port: number | undefined;
  console: boolean;
};

function defaultServeFlags(): ServeFlags {
  return { hostname: "localhost", port: undefined, console: false };
}

/** Applies `arg` to `flags` when it is a server flag. Returns false for any other argument. */
function parseServeFlag(arg: string, flags: ServeFlags): boolean {
  if (arg.startsWith("--hostname=")) {
    flags.hostname = arg.slice("--hostname=".length);
    if (flags.hostname.includes(":")) {
      const [host, portString] = flags.hostname.split(":");
      flags.hostname = host;
      flags.port = parseInt(portString, 10);
    }
  } else if (arg.startsWith("--port=")) {
    flags.port = parseInt(arg.slice("--port=".length), 10);
  } else if (arg.startsWith("--host=")) {
    flags.hostname = arg.slice("--host=".length);
    if (flags.hostname.includes(":")) {
      const [host, portString] = flags.hostname.split(":");
      flags.hostname = host;
      flags.port = parseInt(portString, 10);
    }
  } else if (arg === "--console") {
    flags.console = true;
  } else if (arg === "--no-console") {
    flags.console = false;
  } else {
    return false;
  }
  return true;
}

/**
 * `Bun.serve(options(port))`. When the port is in use, tries the next ports, up to 5 times.
 * `port` undefined uses Bun.serve's default port.
 */
function serveOnFreePort(options: (port: number | undefined) => Serve.Options<undefined>, port: number | undefined) {
  try {
    return Bun.serve(options(port));
  } catch (error: any) {
    if (error?.code === "EADDRINUSE") {
      let defaultPort = port || parseInt(env.PORT || env.BUN_PORT || env.NODE_PORT || "3000", 10);
      for (let remainingTries = 5; remainingTries > 0; remainingTries--) {
        try {
          // Retry with a different port up to 4 times.
          return Bun.serve(options(defaultPort++));
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

type Banner = {
  server: Server<undefined>;
  /** Milliseconds from start to ready. */
  elapsed: string;
  /** The URL path the banner shows. */
  pathname: string;
  /** The routes to list under the URL, each with the file that serves it. Empty to list none. */
  routes: { route: string; file: string }[];
};

/** Prints the startup message, and on a terminal, handles the keyboard shortcuts. */
function printBannerAndHandleShortcuts(banner: Banner) {
  const { server, elapsed, pathname, routes } = banner;
  const enableANSIColors = Bun.enableANSIColors;
  function printInitialMessage(isFirst: boolean) {
    if (enableANSIColors) {
      let topLine = `${server.development ? "\x1b[34;7m DEV \x1b[0m " : ""}\x1b[1;34m\x1b[5mBun\x1b[0m \x1b[1;34mv${Bun.version}\x1b[0m`;
      if (isFirst) {
        topLine += ` \x1b[2mready in\x1b[0m \x1b[1m${elapsed}\x1b[0m ms`;
      }
      if (IS_BUN_DEVELOPMENT && process.env.BUN_DEBUG_DevServer) {
        topLine += `\x1b[2m (PID ${process.pid})\x1b[0m`;
      }
      console.log(topLine + "\n");
      console.log(`\x1b[1;34m➜\x1b[0m \x1b[36m${new URL(pathname, server!.url)}\x1b[0m`);
    } else {
      let topLine = `Bun v${Bun.version}`;
      if (isFirst) {
        if (server.development) {
          topLine += " dev server";
        }
        topLine += ` ready in ${elapsed} ms`;
      }
      console.log(topLine + "\n");
      console.log(`url: ${new URL(pathname, server!.url)}`);
    }
    if (routes.length > 0) {
      console.log("\nRoutes:");

      const pairs = routes.slice();
      pairs.sort((a, b) => {
        if (b.route === "") return 1;
        if (a.route === "") return -1;
        return a.route.localeCompare(b.route);
      });
      for (let i = 0, length = pairs.length; i < length; i++) {
        const { route, file } = pairs[i];
        const isLast = i === length - 1;
        const prefix = isLast ? "  └── " : "  ├── ";
        if (enableANSIColors) {
          console.log(`${prefix}\x1b[36m/${route}\x1b[0m \x1b[2m→ ${path.relative(process.cwd(), file)}\x1b[0m`);
        } else {
          console.log(`${prefix}/${route} → ${path.relative(process.cwd(), file)}`);
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
          } else if (process.platform === "android") {
            Bun.spawn(["/system/bin/am", "start", "-a", "android.intent.action.VIEW", "-d", url]).exited.catch(
              () => {},
            );
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

export default {
  defaultServeFlags,
  parseServeFlag,
  serveOnFreePort,
  printBannerAndHandleShortcuts,
};
