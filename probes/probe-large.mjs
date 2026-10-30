// One stream per connection. The server answers with one large 103 (more than lsquic's initial
// congestion window), then a 200 and the body "hello".
// usage: <bun> probe-large.mjs [fields=54] [valueBytes=2000] [runs=10]
// Prints one JSON line: in how many runs the 200 was lost.
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, listen, QuicEndpoint } from "node:quic";

const keysDir = join(process.env.BUN_REPO ?? "/workspace/bun", "test/js/node/test/fixtures/keys");
const key = createPrivateKey(readFileSync(join(keysDir, "agent1-key.pem")));
const cert = readFileSync(join(keysDir, "agent1-cert.pem"));
const fields = Number(process.argv[2] ?? 54);
const valueBytes = Number(process.argv[3] ?? 2000);
const runs = Number(process.argv[4] ?? 10);
// Bytes that Huffman coding does not shorten.
const value = Buffer.alloc(valueBytes, "~").toString();
const encoder = new TextEncoder();
const application = { maxHeaderLength: 1 << 22 };
const transportParams = { maxIdleTimeout: 30 };
const sent = [];

const server = await listen(
  async session => {
    session.onstream = stream => {
      stream.closed.catch(() => {});
    };
    await session.closed.catch(() => {});
  },
  {
    sni: { "*": { keys: [key], certs: [cert] } },
    transportParams,
    application,
    onheaders() {
      const hint = { ":status": "103" };
      for (let i = 0; i < fields; i++) hint[`x-large-${i}`] = value;
      const info = this.sendInformationalHeaders(hint);
      const response = this.sendHeaders({ ":status": "200" });
      sent.push(`103 ${info}, 200 ${response}`);
      this.writer.writeSync(encoder.encode("hello"));
      this.writer.endSync();
    },
  },
);

async function run() {
  const endpoint = new QuicEndpoint();
  const client = await connect(server.address, {
    endpoint,
    servername: "localhost",
    verifyPeer: "manual",
    transportParams,
    application,
    onerror() {},
  });
  client.closed.catch(() => {});
  await client.opened;
  const events = [];
  const stream = await client.createBidirectionalStream({
    headers: { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" },
    oninfo: headers => {
      let intact = 0;
      for (let i = 0; i < fields; i++) if (headers[`x-large-${i}`] === value) intact++;
      events.push(`info ${headers[":status"]} +${intact}`);
    },
    onheaders: headers => void events.push(`headers ${headers[":status"]}`),
  });
  stream.closed.catch(() => {});
  let got = "";
  try {
    for await (const batch of stream) for (const chunk of batch) got += Buffer.from(chunk).toString("latin1");
    events.push("body " + got);
  } catch (error) {
    events.push("error " + error.code);
  }
  if (!client.destroyed) client.close().catch(() => {});
  await endpoint.close?.().catch?.(() => {});
  return events.join(", ");
}

const watchdog = setTimeout(() => {
  console.log(JSON.stringify({ fields, valueBytes, timeout: true }));
  process.exit(2);
}, 120_000);
const whole = `info 103 +${fields}, headers 200, body hello`;
const kinds = {};
let lost = 0;
for (let i = 0; i < runs; i++) {
  const result = await run();
  kinds[result] = (kinds[result] ?? 0) + 1;
  if (result !== whole) lost++;
}
clearTimeout(watchdog);
console.log(
  JSON.stringify({ fields, valueBytes, runs, lost, sent: Object.fromEntries(Map.groupBy(sent, x => x).entries().map(([k, v]) => [k, v.length])), kinds }),
);
process.exit(0);
