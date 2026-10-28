import { createRequestHandler } from "react-router";
// @ts-ignore: what `react-router build` writes has no declarations (TS7016)
import * as build from "./build/server/index.js";

const handle = createRequestHandler(build as never, "production");
const client = import.meta.dirname + "/build/client";
Bun.serve({
  port: Number(process.env.PORT), hostname: "127.0.0.1",
  async fetch(request: Request) {
    const path = new URL(request.url).pathname;
    if (path !== "/" && !path.includes("..")) { const file = Bun.file(client + path); if (await file.exists()) return new Response(file); }
    return handle(request);
  },
});
