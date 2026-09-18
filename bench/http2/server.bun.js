// Bun.serve with HTTP/2 + HTTP/1.1 on one TLS port (ALPN picks per connection).
import { readFileSync } from "node:fs";

const here = new URL(".", import.meta.url).pathname;
const body = Buffer.alloc(Number(process.env.BODY_SIZE ?? 13), "x").toString();

const server = Bun.serve({
  port: Number(process.env.PORT ?? 0),
  tls: { cert: readFileSync(here + "../grpc-server/cert.pem", "utf8"), key: readFileSync(here + "../grpc-server/key.pem", "utf8") },
  http2: true,
  routes: { "/static": new Response(body) },
  fetch(req) {
    return new Response(body);
  },
});
console.log("READY " + server.port);
