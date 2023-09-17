import * as path from "path";
import { statSync } from "fs";
import type { ServeOptions } from "bun";

const projectRoot = import.meta.dir;
const PUBLIC_DIR = path.resolve(projectRoot, "public");
const BUILD_DIR = path.resolve(projectRoot, ".build");

const PORT = process.env.PORT || 3000;

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
  port: PORT,
  fetch(req) {
    let reqPath = new URL(req.url).pathname;
    console.log(req.method, reqPath);

    const publicResponse = serveFromDir({ directory: PUBLIC_DIR, path: reqPath });
    if (publicResponse) return publicResponse;

    const buildResponse = serveFromDir({ directory: BUILD_DIR, path: reqPath });
    if (buildResponse) return buildResponse;

    return new Response("Not found", {
      status: 404,
    });
  },
} satisfies ServeOptions;
