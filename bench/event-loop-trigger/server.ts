// usage: bun server.ts <http|https|node> — prints the port, serves until killed.
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";

const kind = process.argv[2] ?? "http";
const KB = 1024;
const MB = 1024 * KB;
const body64k = Buffer.alloc(64 * KB, "x");
const body1m = Buffer.alloc(MB, "x");
const body8m = Buffer.alloc(8 * MB, "x");
const filePath = process.env.BENCH_FILE!;

if (kind === "node") {
  const server = createServer((req, res) => res.end("Hello, World!"));
  server.listen(0, "127.0.0.1", () => console.log((server.address() as { port: number }).port));
} else {
  const fixtures = join(import.meta.dir, "../../test/js/bun/http/fixtures");
  const upstream = process.env.BENCH_UPSTREAM;
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 120,
    maxRequestBodySize: 1024 * MB,
    tls:
      kind === "https"
        ? { cert: readFileSync(join(fixtures, "cert.pem")), key: readFileSync(join(fixtures, "cert.key")) }
        : undefined,
    routes: {
      "/static": new Response("Hello, World!"),
      "/hello": () => new Response("Hello, World!"),
      "/json": req => Response.json({ message: "Hello, World!", url: req.url, ua: req.headers.get("user-agent") }),
      "/async": async () => {
        await new Promise(resolve => setImmediate(resolve));
        return new Response("Hello, World!");
      },
      "/64k": () => new Response(body64k),
      "/1m": () => new Response(body1m),
      "/8m": () => new Response(body8m),
      "/file": () => new Response(Bun.file(filePath)),
      "/stream": () => {
        let left = 64;
        return new Response(
          new ReadableStream({
            pull(controller) {
              controller.enqueue(body64k);
              if (--left === 0) controller.close();
            },
          }),
        );
      },
      "/upload": async req => new Response(String((await req.arrayBuffer()).byteLength)),
      "/discard": async req => {
        let total = 0;
        for await (const chunk of req.body!) total += chunk.byteLength;
        return new Response(String(total));
      },
      // A consumer slower than the network: the request body pauses and resumes the socket.
      "/upload-slow": async req => {
        let total = 0;
        for await (const chunk of req.body!) {
          total += chunk.byteLength;
          await new Promise(resolve => setImmediate(resolve));
        }
        return new Response(String(total));
      },
      "/proxy": async () => new Response(await (await fetch(upstream!)).arrayBuffer()),
      "/ws": (req, server) => (server.upgrade(req) ? undefined : new Response("no", { status: 400 })),
    },
    websocket: {
      idleTimeout: 120,
      message(ws, message) {
        ws.send(message);
      },
    },
  });
  console.log(server.port);
}
