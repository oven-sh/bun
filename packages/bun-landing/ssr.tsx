import { file, serve } from "bun";
import "shiki";
import { renderToReadableStream } from "../../test/bun.js/reactdom-bun";

import liveReload from "bun-livereload";
import { join } from "path";

async function fetch(req: Request) {
  if (req.url.endsWith("robots.txt")) {
    return new Response("", { status: 404 });
  }

  if (req.url.endsWith(".css")) {
    return new Response(file(join(import.meta.dir + "/", "index.css")));
  }

  if (!req.url.includes(".")) {
    const { default: Page } = await import("./page.tsx");
    return new Response(await renderToReadableStream(<Page />), {
      headers: {
        "Content-Type": "text/html",
      },
    });
  }

  return new Response(
    file(join(import.meta.dir, "./public/", new URL(req.url).pathname))
  );
}

serve({
  fetch: liveReload(fetch),
  port: 8080,
});
