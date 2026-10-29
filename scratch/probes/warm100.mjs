// Scratch: 40 requests with expect: 100-continue on a warm connection; prints what the client saw and when.
import { readFileSync } from "node:fs";
import { connect, QuicEndpoint } from "node:quic";
const tls = JSON.parse(readFileSync("/tmp/work/recut2/tls.json", "utf8"));
const count = Number(process.argv[2] ?? 40);
const idle = Number(process.argv[3] ?? 5);
const filler = Buffer.alloc(3000, "~").toString();
const body = Buffer.alloc(10, "b");
const server = Bun.serve({ port: 0, tls, http3: true, http1: false, fetch: () => new Response(body, { headers: { "x-filler": filler } }) });
const endpoint = new QuicEndpoint();
const t0 = performance.now();
const at = () => ((performance.now() - t0) / 1000).toFixed(2);
let sessionError;
const client = await connect(`127.0.0.1:${server.port}`, {
  endpoint, servername: "localhost", verifyPeer: "manual", transportParams: { maxIdleTimeout: idle },
  onerror(e) { sessionError ??= `${at()} ${String(e?.message ?? e)}`; },
});
client.closed.then(() => console.log(at(), "client session closed"), e => console.log(at(), "client session closed with", String(e?.message ?? e)));
await client.opened;
const streamErrors = new Map();
const whole = await Promise.all(Array.from({ length: count }, async (_, i) => {
  let interim = "", status = "", field = 0, bytes = 0;
  try {
    const stream = await client.createBidirectionalStream({
      oninfo: h => void (interim = String(h[":status"])),
      onheaders(h) { status = String(h[":status"]); field = String(h["x-filler"] ?? "").length; },
    });
    stream.closed.catch(e => { const m = String(e?.message ?? e); streamErrors.set(m, (streamErrors.get(m) ?? 0) + 1); });
    stream.sendHeaders({ ":method": "POST", ":path": `/${i}`, ":scheme": "https", ":authority": "localhost", expect: "100-continue" }, { terminal: true });
    for await (const batch of stream) for (const chunk of batch) bytes += chunk.byteLength;
  } catch (e) { const m = "iter: " + String(e?.message ?? e); streamErrors.set(m, (streamErrors.get(m) ?? 0) + 1); }
  return interim === "100" && status === "200" && field === filler.length && bytes === body.byteLength;
}));
console.log(at(), JSON.stringify({ whole: whole.filter(Boolean).length, sessionError, streamErrors: [...streamErrors] }));
process.exit(0);
