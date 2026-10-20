// The parts of `bun ./index.html` (internal/html.ts) and `bun bake` (internal/bake.ts) that start
// the server and talk to the terminal.
import type { Serve, Server } from "bun";

const path = require("node:path");

const env = Bun.env;

const isRestarting = $newRustFunction("bake/config/plugins.rs", "isRestarting", 0);

type ServeFlags = {
  /** `undefined` until `--host` or `--hostname` sets it. */
  hostname: string | undefined;
  port: number | undefined;
  console: boolean;
};

function defaultServeFlags(): ServeFlags {
  return { hostname: undefined, port: undefined, console: false };
}

/** The port in the value of `name`: a whole number from 0 to 65535. */
function parsePort(name: string, value: string): number {
  const port = Number(value);
  // Only digits: `Number()` also reads " ", "0x1F90" and "1e3".
  if (!/^\d+$/.test(value) || port > 65535) {
    throw new Error(`"${name}" needs a port from 0 to 65535, not "${value}".`);
  }
  return port;
}

/** Sets the hostname, and the port if there is one: `host`, `host:3000`, `::1`, `[::1]` or `[::1]:3000`. */
function applyHost(name: string, value: string, flags: ServeFlags) {
  const end = value.startsWith("[") ? value.indexOf("]") : -1;
  if (end !== -1) {
    flags.hostname = value.slice(1, end);
    const rest = value.slice(end + 1);
    if (rest.startsWith(":")) flags.port = parsePort(name, rest.slice(1));
  } else {
    const colon = value.indexOf(":");
    // More than one `:` is an IPv6 address without a port.
    if (colon !== -1 && colon === value.lastIndexOf(":")) {
      flags.hostname = value.slice(0, colon);
      flags.port = parsePort(name, value.slice(colon + 1));
    } else {
      flags.hostname = value;
    }
  }
  // `Bun.serve` reads an empty hostname as none, and listens on every interface, not on localhost.
  if (flags.hostname === "") throw new Error(`"${name}" needs a hostname.`);
}

/**
 * Applies the server flag at `args[i]` to `flags`, as `--port=3000` or `--port 3000`.
 * Returns how many arguments it used: 0 when `args[i]` is not a server flag.
 */
function parseServeFlag(args: string[], i: number, flags: ServeFlags): number {
  const arg = args[i];
  if (arg === "--console") {
    flags.console = true;
    return 1;
  }
  if (arg === "--no-console") {
    flags.console = false;
    return 1;
  }
  for (const name of ["--hostname", "--host", "--port"]) {
    let value: string;
    let used: number;
    if (arg.startsWith(name + "=")) {
      value = arg.slice(name.length + 1);
      used = 1;
    } else if (arg === name) {
      if (i + 1 >= args.length) throw new Error(`"${name}" needs a value.`);
      value = args[i + 1];
      used = 2;
    } else {
      continue;
    }
    if (name === "--port") {
      flags.port = parsePort(name, value);
    } else {
      applyHost(name, value, flags);
    }
    return used;
  }
  return 0;
}

/**
 * `Bun.serve(options(port))`. When the port is in use, tries the next ports, up to 5 times.
 * `port` undefined uses Bun.serve's default port.
 */
function serveOnFreePort(
  id: string,
  options: (port: number | undefined) => Serve.Options<undefined>,
  port: number | undefined,
) {
  // Under `--hot`, a reload calls this again and `Bun.serve` finds the running server by `id`.
  // Without a fixed `id`, it looks for one on the first port, and starts a second server when the
  // first one is on a port that the retries picked.
  // Sets `id` on the options object itself: a copy would drop what it inherits, as `bun bake` does
  // from the export of `app/server.ts`.
  const withId = (port: number | undefined) => {
    const opts = options(port);
    Object.defineProperty(opts, "id", { value: id, writable: true, enumerable: true, configurable: true });
    return opts;
  };
  try {
    return Bun.serve(withId(port));
  } catch (error: any) {
    if (error?.code === "EADDRINUSE") {
      let defaultPort = port || parseInt(env.PORT || env.BUN_PORT || env.NODE_PORT || "3000", 10);
      for (let remainingTries = 5; remainingTries > 0; remainingTries--) {
        try {
          // Retry with a different port up to 4 times.
          return Bun.serve(withId(defaultPort++));
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

// Under `bun --hot`, each reload calls `printBannerAndHandleShortcuts` again, but this module is
// evaluated once. The listeners are added once, and use the server and banner of the latest call.
let latestServer: Server<undefined> | undefined;
let printLatestBanner: ((isFirst: boolean) => void) | undefined;

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

  const installed = latestServer !== undefined;
  latestServer = server;
  printLatestBanner = printInitialMessage;

  // Keyboard shortcuts
  if (!installed && process.stdin.isTTY) {
    // Handle Ctrl+C and other termination signals. Not during a restart, which sends one of them to
    // run the app's listeners: `process.exit()` would end the restart before the listeners after
    // this one run.
    const exit = () => {
      if (!isRestarting()) process.exit();
    };
    process.on("SIGINT", exit);
    process.on("SIGHUP", exit);
    process.on("SIGTERM", exit);
    process.stdin.on("data", data => {
      const key = data.toString().toLowerCase().replaceAll("\r\n", "\n");

      switch (key) {
        case "\x03": // Ctrl+C
        case "q\n":
          process.exit();
          break;

        case "c\n":
          console.clear();
          printLatestBanner!(false);
          break;

        case "o\n":
          const url = latestServer!.url.toString();

          // TODO: copy the AppleScript from create-react-app or Vite.
          const opener =
            process.platform === "darwin"
              ? ["open", url]
              : process.platform === "win32"
                ? // `start` is a command of cmd.exe, not a program. Its first quoted argument is the window title.
                  ["cmd", "/c", "start", "", url]
                : process.platform === "android"
                  ? ["/system/bin/am", "start", "-a", "android.intent.action.VIEW", "-d", url]
                  : ["xdg-open", url];
          try {
            Bun.spawn(opener).exited.catch(() => {});
          } catch {
            // `Bun.spawn` throws when the opener is not installed. The URL is in the banner.
            console.log(`Could not open a browser. Open ${url}`);
          }
          break;

        case "h\n":
          console.clear();
          printLatestBanner!(false);
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
