// Scratch: a node:quic server answers COUNT requests in one turn with a 103 and a 200 that each have an N-byte field,
// then a 10-byte body. Default windows. Prints how many responses arrive whole and how often sendHeaders() said false.
// usage: refused-block.mjs [COUNT=40] [N=3000]
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { connect, listen, QuicEndpoint } from "node:quic";
const dir = "/tmp/recut/bun/test/js/node/test/fixtures/keys/";
const key = createPrivateKey(readFileSync(dir + "agent1-key.pem"));
const cert = readFileSync(dir + "agent1-cert.pem");
const count = Number(process.argv[2] ?? 40);
const n = Number(process.argv[3] ?? 3000);
const filler = Buffer.alloc(n, "~").toString();
const body = Buffer.alloc(10, "b");
const waiting = [];
let refused = 0;
const server = await listen(
  session => {
    session.onerror = () => {};
    session.closed.catch(() => {});
    session.onstream = stream => void stream.closed.catch(() => {});
  },
  {
    sni: { "*": { keys: [key], certs: [cert] } },
    transportParams: { maxIdleTimeout: 5, initialMaxStreamsBidi: count },
    onheaders() {
      if (waiting.push(this) < count) return;
      for (const stream of waiting) {
        stream.sendInformationalHeaders({ ":status": "103", "x-filler": filler });
        if (!stream.sendHeaders({ ":status": "200", "x-filler": filler })) refused++;
        try {
          stream.writer.writeSync(body);
          stream.writer.endSync();
        } catch {}
      }
    },
  },
);
const endpoint = new QuicEndpoint();
const client = await connect(server.address, {
  endpoint, servername: "localhost", verifyPeer: "manual",
  application: { maxHeaderLength: 65536 },
  transportParams: { maxIdleTimeout: 5 }, onerror() {},
});
client.closed.catch(() => {});
await client.opened;
const errors = new Map();
const whole = await Promise.all(Array.from({ length: count }, async (_, i) => {
  let status = "", field = 0, bytes = 0;
  try {
    const stream = await client.createBidirectionalStream({
      onheaders(h) { status = String(h[":status"]); field = String(h["x-filler"] ?? "").length; },
    });
    stream.closed.catch(e => { const m = String(e?.code ?? e?.message ?? e); errors.set(m, (errors.get(m) ?? 0) + 1); });
    stream.sendHeaders({ ":method": "GET", ":path": `/${i}`, ":scheme": "https", ":authority": "localhost" }, { terminal: true });
    for await (const batch of stream) for (const chunk of batch) bytes += chunk.byteLength;
  } catch {}
  return status === "200" && field === n && bytes === body.byteLength;
}));
console.log(JSON.stringify({ whole: whole.filter(Boolean).length, refused, errors: [...errors] }));
process.exit(0);
