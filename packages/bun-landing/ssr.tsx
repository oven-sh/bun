import React from "react";
import { file, serve } from "bun";

import { renderToReadableStream } from "./react-dom-server.bun.production.min";

import liveReload from "bun-livereload";
import { join } from "path";

async function fetch(req: Request) {
  if (req.url.endsWith("favicon.ico")) {
    return new Response("", { status: 404 });
  }

  if (!req.url.includes(".")) {
    const { default: Page } = await import("./page.jsx");
    return new Response(await renderToReadableStream(<Page />), {
      headers: {
        "Content-Type": "text/html",
      },
    });
  }

  return new Response(file(join(import.meta.dir, new URL(req.url).pathname)));
}

serve({
  fetch: liveReload(fetch),
});
