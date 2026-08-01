// h2-capable TLS server for the h2-default bench.
// allowHTTP1: true so ALPN decides: a client offering only http/1.1 gets h1,
// a client offering h2 gets h2. Tracks TCP-level connections and h2 sessions
// so the client can read back how many sockets / handshakes it caused.
//
// Usage: bun server.ts [payload-bytes]
// Prints "PORT <n>" on stdout once listening so the driver can scrape it.

import http2 from "node:http2";
import type { AddressInfo } from "node:net";
import { once } from "node:events";
import { tls } from "./tls.ts";

const payloadSize = Number(process.argv[2] ?? 4096);
const payload = Buffer.alloc(payloadSize, "x");

let tcpConnections = 0;
let h2Sessions = 0;
let liveSockets = 0;
let maxLiveSockets = 0;
let requests = 0;

const server = http2.createSecureServer({ ...tls, allowHTTP1: true }, (req, res) => {
  if (req.url === "/stats") {
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        tcpConnections,
        h2Sessions,
        liveSockets,
        maxLiveSockets,
        requests,
        alpn: (req.socket as any).alpnProtocol,
      }),
    );
    return;
  }
  if (req.url === "/reset") {
    tcpConnections = 0;
    h2Sessions = 0;
    maxLiveSockets = 0;
    requests = 0;
    res.end("ok");
    return;
  }
  requests++;
  res.setHeader("content-type", "application/octet-stream");
  res.setHeader("content-length", String(payload.length));
  res.end(payload);
});

server.on("connection", () => {
  // raw TCP accept (pre-TLS) — fires for http2 compat server on secureConnection only,
  // so count secureConnection instead.
});
server.on("secureConnection", sock => {
  tcpConnections++;
  liveSockets++;
  if (liveSockets > maxLiveSockets) maxLiveSockets = liveSockets;
  sock.on("close", () => {
    liveSockets--;
  });
  sock.on("error", () => {});
});
server.on("session", () => {
  h2Sessions++;
});
server.on("clientError", () => {});

server.listen(0);
await once(server, "listening");
const { port } = server.address() as AddressInfo;
console.log(`PORT ${port}`);
console.error(`[server] listening on https://localhost:${port} payload=${payloadSize}`);

// keep alive
await new Promise(() => {});
