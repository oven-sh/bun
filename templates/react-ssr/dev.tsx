import * as path from "path";
import { statSync } from "fs";
import type { ServeOptions } from "bun";
import { renderToReadableStream, renderToString } from "react-dom/server";

const PROJECT_ROOT = import.meta.dir;
const PUBLIC_DIR = path.resolve(PROJECT_ROOT, "public");
const BUILD_DIR = path.resolve(PROJECT_ROOT, ".build");

const srcRouter = new Bun.FileSystemRouter({
  dir: "./pages",
  style: "nextjs",
});

await Bun.build({
  entrypoints: [import.meta.dir + "/hydrate.tsx", ...Object.values(srcRouter.routes)],
  outdir: BUILD_DIR,
  target: "browser",
  splitting: true,
});

const buildRouter = new Bun.FileSystemRouter({
  dir: BUILD_DIR,
  style: "nextjs",
});

function serveFromDir(config: { directory: string; path: string }): Response | null {
  let basePath = path.join(config.directory, config.path);
  const suffixes = ["", ".html", "index.html"];

  for (const suffix of suffixes) {
    try {
      const pathWithSuffix = path.join(basePath, suffix);
      const stat = statSync(pathWithSuffix);
      if (stat && stat.isFile()) {
        return new Response(Bun.file(pathWithSuffix));
      }
    } catch (err) {}
  }

  return null;
}

export default {
  async fetch(request) {
    const match = srcRouter.match(request);
    if (match) {
      const builtMatch = buildRouter.match(request);
      if (!builtMatch) {
        return new Response("Unknown error", { status: 500 });
      }

      const Component = await import(match.filePath);
      const stream = await renderToReadableStream(<Component.default />, {
        bootstrapScriptContent: `globalThis.PATH_TO_PAGE = "/${builtMatch.src}";`,
        bootstrapModules: ["/hydrate.js"],
      });

      return new Response(stream, {
        "headers": { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    let reqPath = new URL(request.url).pathname;
    console.log(request.method, reqPath);
    if (reqPath === "/") reqPath = "/index.html";

    // check public
    const publicResponse = serveFromDir({ directory: PUBLIC_DIR, path: reqPath });
    if (publicResponse) return publicResponse;

    // check /.build
    const buildResponse = serveFromDir({ directory: BUILD_DIR, path: reqPath });
    if (buildResponse) return buildResponse;

    return new Response("File not found", {
      status: 404,
    });
  },
} satisfies ServeOptions;
