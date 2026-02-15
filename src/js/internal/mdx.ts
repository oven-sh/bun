// This is the file that loads when you pass a '.mdx' entry point to Bun.
// It generates temporary HTML entry points that mount MDX modules and serves them.
import type { HTMLBundle, Server } from "bun";
const initial = performance.now();
const argv = process.argv;

const path = require("node:path");
const fs = require("node:fs");

const env = Bun.env;

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function emitMdxWrapperScript(compiledTsxName: string) {
  // Use string concatenation to avoid the build preprocessor's import-extraction regex
  // from matching import statements inside this template literal.
  const imp = "import";
  return [
    imp + ' React from "react";',
    imp + ' { createRoot } from "react-dom/client";',
    imp + " MDXContent from './" + compiledTsxName + "';",
    "",
    'const rootEl = document.getElementById("root");',
    "if (!rootEl) {",
    '  throw new Error("Missing #root mount element for MDX page");',
    "}",
    "",
    "const root = createRoot(rootEl);",
    "root.render(React.createElement(MDXContent, {}));",
  ].join("\n");
}

function emitMdxHtmlShell(wrapperScriptName: string, title: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${title}</title>
    <style>
      html, body {
        margin: 0;
        padding: 0;
      }
      body {
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
        line-height: 1.5;
        padding: 2rem;
      }
      img {
        max-width: 100%;
      }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./${wrapperScriptName}"></script>
  </body>
</html>
`;
}

async function start() {
  let args: string[] = [];
  const cwd = process.cwd();
  let hostname = "localhost";
  let port: number | undefined = undefined;
  let enableConsoleLog = false;

  for (let i = 1, argvLength = argv.length; i < argvLength; i++) {
    const arg = argv[i];

    if (!arg.endsWith(".mdx")) {
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
Bun v${Bun.version} (mdx)

Usage:
  bun [...mdx-files] [options]

Options:

  --port=<NUM>
  --host=<STR>, --hostname=<STR>
  --console # print console logs from browser
  --no-console # don't print console logs from browser
Examples:

  bun index.mdx
  bun ./index.mdx ./docs/getting-started.mdx --port=3000
  bun index.mdx --host=localhost:3000
  bun index.mdx --hostname=localhost:3000
  bun ./*.mdx
  bun index.mdx --console
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
    throw new Error("No MDX files found matching " + JSON.stringify(Bun.main));
  }

  args.sort((a, b) => a.localeCompare(b));

  let needsPop = false;
  if (args.length === 1) {
    args.push(process.cwd());
    needsPop = true;
  }

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
    args.pop();
  }

  const servePaths = args.map(arg => {
    if (process.platform === "win32") {
      arg = arg.replaceAll("\\", "/");
    }
    const basename = path.basename(arg);
    const isIndexMdx = basename === "index.mdx";

    let servePath = arg;
    if (servePath.startsWith(longestCommonPath)) {
      servePath = servePath.slice(longestCommonPath.length);
    } else {
      const relative = path.relative(longestCommonPath, servePath);
      if (!relative.startsWith("..")) {
        servePath = relative;
      }
    }

    if (isIndexMdx && servePath.length === 0) {
      servePath = "/";
    } else if (isIndexMdx) {
      servePath = servePath.slice(0, -"index.mdx".length);
    }

    if (servePath.endsWith(".mdx")) {
      servePath = servePath.slice(0, -".mdx".length);
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

  const tmpRoot = path.join(cwd, `.bun-mdx-${process.pid}`);
  ensureDir(tmpRoot);

  // Clean up temp directory on exit
  process.on("exit", () => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  });

  const Mdx = (Bun as any).mdx as { compile(input: string): string };

  const compiledTsxName = "mdx-compiled.tsx";

  const htmlEntryPaths = args.map((mdxPath, index) => {
    const entryDir = path.join(tmpRoot, String(index));
    ensureDir(entryDir);

    // Pre-compile MDX → TSX so the dev server bundler only sees standard TSX.
    // The dev server's incremental graph can't handle .mdx files directly.
    const mdxSource = fs.readFileSync(mdxPath, "utf8");
    const compiledTsx = Mdx.compile(mdxSource);
    fs.writeFileSync(path.join(entryDir, compiledTsxName), compiledTsx, "utf8");

    const wrapperScriptName = "entry.js";
    const wrapperScriptPath = path.join(entryDir, wrapperScriptName);
    const htmlPath = path.join(entryDir, "index.html");

    fs.writeFileSync(wrapperScriptPath, emitMdxWrapperScript(compiledTsxName), "utf8");
    fs.writeFileSync(htmlPath, emitMdxHtmlShell(wrapperScriptName, path.basename(mdxPath)), "utf8");
    return htmlPath;
  });

  const htmlImports = await Promise.all(
    htmlEntryPaths.map(arg => {
      return import(arg).then(m => m.default as HTMLBundle);
    }),
  );

  if (htmlImports.length === 1) {
    servePaths[0] = "*";
  }

  const staticRoutes = htmlImports.reduce(
    (acc, htmlImport, index) => {
      const servePath = servePaths[index];
      acc["/" + servePath] = htmlImport;
      return acc;
    },
    {} as Record<string, HTMLBundle>,
  );

  let server: Server;
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
        fetch() {
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
              port: defaultPort++,
              fetch() {
                return new Response("Not found", { status: 404 });
              },
            });
            break getServer;
          } catch (retryError: any) {
            if (retryError?.code === "EADDRINUSE") {
              continue;
            }
            throw retryError;
          }
        }
      }
      throw error;
    }
  }

  // Watch original .mdx source files and re-compile on change so the dev
  // server's HMR picks up the updated TSX in the temp directory.
  if (server!.development) {
    for (let i = 0, length = args.length; i < length; i++) {
      const mdxPath = args[i];
      const compiledTsxPath = path.join(tmpRoot, String(i), compiledTsxName);
      let pending = false;
      fs.watch(mdxPath, (_event: string) => {
        if (pending) return;
        pending = true;
        // Coalesce rapid successive events (editors often emit multiple writes)
        setTimeout(() => {
          pending = false;
          try {
            const source = fs.readFileSync(mdxPath, "utf8");
            const compiled = Mdx.compile(source);
            fs.writeFileSync(compiledTsxPath, compiled, "utf8");
          } catch (err: any) {
            if (Bun.enableANSIColors) {
              console.error(
                `\x1b[31m[mdx]\x1b[0m compile error in \x1b[36m${path.relative(cwd, mdxPath)}\x1b[0m: ${err?.message ?? err}`,
              );
            } else {
              console.error(`[mdx] compile error in ${path.relative(cwd, mdxPath)}: ${err?.message ?? err}`);
            }
          }
        }, 50);
      });
    }
  }

  const elapsed = (performance.now() - initial).toFixed(2);
  const enableANSIColors = Bun.enableANSIColors;

  function printInitialMessage(isFirst: boolean) {
    let pathnameToPrint;
    if (servePaths.length === 1) {
      pathnameToPrint = servePaths[0];
    } else {
      const indexRoute = servePaths.find(a => a === "index" || a === "" || a === "/");
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
        pairs.push({ route: servePaths[i], importPath: args[i] });
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
  }

  printInitialMessage(true);
}

export default start;
