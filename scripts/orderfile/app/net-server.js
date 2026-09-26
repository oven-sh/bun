// Every server the app's features talk to, run as `<app> netserver` in a process
// of its own (servers.js) so that only the client side is traced. Prints one
// JSON line of ports, then serves until its stdin closes.
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";
const dir = process.env.ORDERFILE_APP_DATA;
const CERT = fs.readFileSync(path.join(dir, "cert.pem"), "utf8");
const KEY = fs.readFileSync(path.join(dir, "key.pem"), "utf8");
const sleep = ms => new Promise(r => setTimeout(r, ms));
const bigObj = {
  data: Array.from({ length: 2000 }, (_, i) => ({ id: i, text: "chunk " + i, meta: { t: 1.7e12 + i, ok: true } })),
};
const words = Array.from(
  { length: 4000 },
  (_, i) => ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"][(i * 2654435761) % 8] + (i % 97),
).join(" ");
// The same routes over TLS and over plain HTTP.
const routes = {
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/json")
      return Response.json(bigObj, { headers: { "x-request-id": crypto.randomUUID(), "cache-control": "no-store" } });
    if (url.pathname === "/gzip")
      return new Response(Bun.gzipSync(JSON.stringify(bigObj)), {
        headers: { "content-encoding": "gzip", "content-type": "application/json" },
      });
    if (url.pathname === "/zstd")
      return new Response(Bun.zstdCompressSync(Buffer.from(words)), { headers: { "content-encoding": "zstd" } });
    if (url.pathname === "/echo") {
      const body = await req.text();
      return new Response(JSON.stringify({ got: body.length, h: Object.fromEntries(req.headers) }), {
        status: 201,
        headers: { "set-cookie": "a=b; Path=/; HttpOnly", "content-type": "application/json" },
      });
    }
    if (url.pathname === "/sse") {
      let i = 0;
      const enc = new TextEncoder();
      return new Response(
        new ReadableStream({
          async pull(c) {
            if (i >= 60) {
              c.enqueue(enc.encode("event: done\ndata: [DONE]\n\n"));
              c.close();
              return;
            }
            c.enqueue(
              enc.encode(
                `event: delta\ndata: ${JSON.stringify({ i, text: "tok" + i + " ", usage: { in: i * 3, out: i } })}\n\n`,
              ),
            );
            i++;
            await sleep(20);
          },
        }),
        { headers: { "content-type": "text/event-stream", "cache-control": "no-cache" } },
      );
    }
    if (url.pathname === "/slow") {
      await sleep(5000);
      return new Response("late");
    }
    if (url.pathname === "/empty") return new Response(null, { status: 204 });
    if (url.pathname === "/file") return new Response(Bun.file(path.join(dir, "cert.pem")));
    return new Response("not found: " + url.pathname, { status: 404 });
  },
};
const tlsServer = Bun.serve({ port: 0, hostname: "127.0.0.1", tls: { cert: CERT, key: KEY }, ...routes });
const plainBun = Bun.serve({ port: 0, hostname: "127.0.0.1", ...routes });
const listen = (srv, host = "127.0.0.1") => new Promise(r => srv.listen(0, host, () => r(srv.address().port)));
const plain = await listen(
  http.createServer((req, res) => {
    let n = 0;
    req.on("data", c => (n += c.length));
    req.on("end", () => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ n, url: req.url, method: req.method }));
    });
  }),
);
const echo = await listen(
  net.createServer(s => {
    s.on("data", d => s.write(d));
    s.on("end", () => s.end());
    s.on("error", () => {});
  }),
);
// An HTTP proxy: CONNECT tunnels, and absolute-URI requests forwarded to the origin.
const proxy = await listen(
  net.createServer(client => {
    client.on("error", () => {});
    client.once("data", head => {
      const m = /^CONNECT ([^:]+):(\d+)/.exec(head.toString());
      if (!m) {
        const f = /^([A-Z]+) http:\/\/([^/:]+):(\d+)(\/\S*) (HTTP\/1\.[01])\r\n/.exec(head.toString("latin1"));
        if (!f) return client.destroy();
        const up = net.connect(+f[3], "127.0.0.1", () => {
          up.write(Buffer.concat([Buffer.from(`${f[1]} ${f[4]} ${f[5]}\r\n`), head.subarray(f[0].length)]));
          up.pipe(client);
          client.pipe(up);
        });
        up.on("error", () => client.destroy());
        return;
      }
      const up = net.connect(+m[2], m[1] === "localhost" ? "127.0.0.1" : m[1], () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        up.pipe(client);
        client.pipe(up);
      });
      up.on("error", () => client.destroy());
    });
  }),
);
process.stdout.write(JSON.stringify({ tls: tlsServer.port, plainBun: plainBun.port, plain, echo, proxy }) + "\n");
process.stdin.on("data", () => {});
process.stdin.on("end", () => process.exit(0));
process.stdin.on("close", () => process.exit(0));
setTimeout(() => process.exit(0), 120000).unref();
