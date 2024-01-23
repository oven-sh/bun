import { serve, file } from "bun";
import { existsSync, statSync } from "node:fs";

const baseUrl = new URL("../dist/", import.meta.url);

const server = serve({
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(new URL(request.url).pathname.slice(1), baseUrl);
    if (!existsSync(pathname) || !statSync(pathname).isFile()) {
      return new Response(null, { status: 404 });
    }
    return new Response(file(pathname));
  },
});

console.log("Listening...", server.url.toString());
