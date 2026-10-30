// A node:quic HTTP/3 server answers every request with a 103 that has one `link` field, then a 200.
// usage: <bun> probe-burst.mjs [streams=24] [linkBytes=6000] [body=hello]
// Prints one JSON line: how many sendHeaders() calls returned false, and what the client got.
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, listen, QuicEndpoint } from "node:quic";

const keysDir = join(process.env.BUN_REPO ?? "/workspace/bun", "test/js/node/test/fixtures/keys");
const key = createPrivateKey(readFileSync(join(keysDir, "agent1-key.pem")));
const cert = readFileSync(join(keysDir, "agent1-cert.pem"));
const streams = Number(process.argv[2] ?? 24);
const linkBytes = Number(process.argv[3] ?? 6000);
const body = process.argv[4] ?? "hello";
// Bytes that Huffman coding does not shorten.
const link = Buffer.alloc(linkBytes, "~").toString();
const encoder = new TextEncoder();
const maxIdleTimeout = 30;
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
    transportParams: { maxIdleTimeout, initialMaxStreamsBidi: streams },
    application: { maxHeaderLength: 1 << 20 },
    onheaders() {
      sent.push(this.sendInformationalHeaders({ ":status": "103", link }), this.sendHeaders({ ":status": "200" }));
      if (body) this.writer.writeSync(encoder.encode(body));
      this.writer.endSync();
    },
  },
);
const endpoint = new QuicEndpoint();
const client = await connect(server.address, {
  endpoint,
  servername: "localhost",
  verifyPeer: "manual",
  transportParams: { maxIdleTimeout },
  application: { maxHeaderLength: 1 << 20 },
  onerror() {},
});
client.closed.catch(() => {});
await client.opened;

async function response() {
  const events = [];
  const stream = await client.createBidirectionalStream({
    headers: { ":method": "GET", ":path": "/", ":scheme": "https", ":authority": "localhost" },
    oninfo: headers => void events.push(`info ${headers[":status"]} ${headers.link === link ? "intact" : "damaged"}`),
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
  return events.join(", ");
}

const watchdog = setTimeout(() => {
  console.log(JSON.stringify({ streams, linkBytes, timeout: true, refused: sent.filter(taken => !taken).length }));
  process.exit(2);
}, 60_000);
const responses = await Promise.all(Array.from({ length: streams }, response));
clearTimeout(watchdog);
const count = needle => responses.filter(r => r.includes(needle)).length;
const whole = `info 103 intact, headers 200, body ${body}`;
const kinds = {};
for (const r of responses) kinds[r] = (kinds[r] ?? 0) + 1;
console.log(
  JSON.stringify({
    streams,
    linkBytes,
    refused: sent.filter(taken => !taken).length,
    complete: responses.filter(r => r === whole).length,
    lost: responses.filter(r => r !== whole).length,
    info103: count("info 103"),
    headers200: count("headers 200"),
    bodies: count("body " + body),
    errors: count("error "),
    kinds,
  }),
);
if (!client.destroyed) client.close().catch(() => {});
await server.close?.().catch?.(() => {});
process.exit(0);
