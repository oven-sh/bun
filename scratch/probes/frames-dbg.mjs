// Scratch: Bun.serve HTTP/3 and a node:quic client in one process. COUNT responses with a FIELD-byte header field and a
// BODY-byte body into a client connection window of WINDOW bytes. With BUN_DEBUG_lsquic=1 on a debug build, lsquic's
// log goes to stderr: count the server's STREAM frames there.
// usage: frames.mjs [COUNT=100] [WINDOW=30000] [FIELD=0] [BODY=3000] [sameTurn=1]
import { readFileSync } from "node:fs";
import { connect, QuicEndpoint } from "node:quic";
const tls = JSON.parse(readFileSync("/tmp/work/recut2/tls.json", "utf8"));
const count = Number(process.argv[2] ?? 100);
const window = Number(process.argv[3] ?? 30000);
const fieldSize = Number(process.argv[4] ?? 0);
const bodySize = Number(process.argv[5] ?? 3000);
const sameTurn = (process.argv[6] ?? "1") === "1";
const filler = Buffer.alloc(fieldSize, "~").toString();
const body = Buffer.alloc(bodySize, "b");
const everyRequest = Promise.withResolvers();
let requests = 0;
const server = Bun.serve({
  port: 0, tls, http3: true, http1: false,
  async fetch() {
    if (sameTurn) {
      if (++requests === count) { console.error("all requests", Math.round(performance.now())); everyRequest.resolve(); }
      await everyRequest.promise;
    }
    return new Response(body, fieldSize ? { headers: { "x-filler": filler } } : undefined);
  },
});
const endpoint = new QuicEndpoint();
const client = await connect(`127.0.0.1:${server.port}`, {
  endpoint, servername: "localhost", verifyPeer: "manual",
  transportParams: { maxIdleTimeout: 5, initialMaxData: window }, onerror() {},
});
client.closed.catch(() => {});
await client.opened; console.error("opened", Math.round(performance.now()));
const whole = await Promise.all(Array.from({ length: count }, async (_, i) => {
  let status = "", field = 0, bytes = 0;
  try {
    const stream = await client.createBidirectionalStream({
      headers: { ":method": "GET", ":path": `/${i}`, ":scheme": "https", ":authority": "localhost" },
      onheaders(h) { status = String(h[":status"]); field = String(h["x-filler"] ?? "").length; },
    });
    stream.closed.catch(() => {});
    for await (const batch of stream) for (const chunk of batch) bytes += chunk.byteLength;
  } catch {}
  return status === "200" && field === fieldSize && bytes === bodySize;
}));
console.log(JSON.stringify({ whole: whole.filter(Boolean).length, port: server.port }));
process.exit(0);
