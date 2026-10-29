// Scratch: a Bun.serve HTTP/3 server for a stock client. /big answers with 5 MB. Every other path reads the request's
// body and answers with a FIELD-byte header field and a 10-byte body.
// usage: serve100.mjs [FIELD=3000]   (prints the port, runs until killed)
import { readFileSync } from "node:fs";
const tls = JSON.parse(readFileSync("/tmp/work/recut2/tls.json", "utf8"));
const field = Number(process.argv[2] ?? 3000);
const filler = Buffer.alloc(field, "~").toString();
const big = Buffer.alloc(5_000_000, "B");
const server = Bun.serve({
  port: 0, tls, http3: true, http1: false,
  fetch: async req => {
    if (new URL(req.url).pathname === "/big") return new Response(big);
    await req.arrayBuffer();
    return new Response("0123456789", { headers: { "x-filler": filler } });
  },
});
console.log(server.port);
