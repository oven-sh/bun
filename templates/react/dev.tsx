import * as path from "path";

import { existsSync } from "fs";
import type { ServeOptions } from "bun";

const projectRoot = import.meta.dir;
const PUBLIC_DIR = path.resolve(projectRoot, "public");
const BUILD_DIR = path.resolve(projectRoot, "build");

export default {
  fetch(request) {
    let reqPath = new URL(request.url).pathname;
    console.log(request.method, reqPath);
    if (reqPath === "/") reqPath = "/index.html";

    // serve static files
    const publicFilePath = path.join(PUBLIC_DIR, reqPath);
    if (existsSync(publicFilePath)) {
      return new Response(Bun.file(publicFilePath));
    }

    // serve build files
    const buildFilePath = path.join(BUILD_DIR, reqPath);
    if (existsSync(buildFilePath)) {
      return new Response(Bun.file(buildFilePath));
    }

    return new Response("File not found", {
      status: 404,
    });
  },
} satisfies ServeOptions;
