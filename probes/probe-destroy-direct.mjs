// The case that the header queue does not cover: a later header block that lsquic takes directly and
// holds in part, with a body behind it, and destroy() in the same turn.
// The server answers "/" with a small 103, a large 200, a body, and then calls destroy().
// It answers "/next" with a 204. The probe reports what the first stream got, and whether the
// connection still answers "/next".
// usage: <bun> probe-destroy-direct.mjs [runs=12] [fields=100] [valueBytes=2000] [bodyBytes=5]
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connect, listen, QuicEndpoint } from "node:quic";

const keysDir = join(process.env.BUN_REPO ?? "/workspace/bun", "test/js/node/test/fixtures/keys");
const key = createPrivateKey(readFileSync(join(keysDir, "agent1-key.pem")));
const cert = readFileSync(join(keysDir, "agent1-cert.pem"));
const runs = Number(process.argv[2] ?? 12);
const fields = Number(process.argv[3] ?? 100);
const valueBytes = Number(process.argv[4] ?? 2000);
const bodyBytes = Number(process.argv[5] ?? 5);
const value = Buffer.alloc(valueBytes, "v").toString();
const body = Buffer.alloc(bodyBytes, "b");
const application = { maxHeaderLength: 1 << 22 };
const transportParams = { maxIdleTimeout: 5 };
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
    onheaders(headers) {
      if (headers[":path"] === "/next") {
        this.sendHeaders({ ":status": "204" });
        this.writer.endSync();
        return;
      }
      const response = { ":status": "200" };
      for (let i = 0; i < fields; i++) response[`x-large-${i}`] = value;
      sent.push(
        this.sendInformationalHeaders({ ":status": "103", link: "</a.js>; rel=preload" }),
        this.sendHeaders(response),
      );
      this.writer.writeSync(body);
      this.writer.endSync();
      this.destroy();
    },
  },
);

async function exchange(client, path) {
  const events = [];
  try {
    const stream = await client.createBidirectionalStream({
      headers: { ":method": "GET", ":path": path, ":scheme": "https", ":authority": "localhost" },
      oninfo: headers => void events.push(`info ${headers[":status"]}`),
      onheaders: headers => {
        let intact = 0;
        for (let i = 0; i < fields; i++) if (headers[`x-large-${i}`] === value) intact++;
        events.push(`headers ${headers[":status"]}${intact ? ` +${intact}` : ""}`);
      },
    });
    stream.closed.catch(() => {});
    let got = 0;
    for await (const batch of stream) for (const chunk of batch) got += chunk.byteLength;
    events.push("body " + got);
  } catch (error) {
    events.push("error " + (error.code ?? error.message));
  }
  return events.join(", ");
}

async function run() {
  const endpoint = new QuicEndpoint();
  let sessionError = "";
  const client = await connect(server.address, {
    endpoint,
    servername: "localhost",
    verifyPeer: "manual",
    transportParams,
    application,
    onerror(error) {
      sessionError = `${error?.code ?? ""} ${error?.message ?? error}`.trim();
    },
  });
  client.closed.catch(error => {
    sessionError ||= `${error?.code ?? ""} ${error?.message ?? error}`.trim();
  });
  await client.opened;
  const first = await exchange(client, "/");
  const next = await Promise.race([
    exchange(client, "/next"),
    new Promise(resolve => setTimeout(() => resolve("no answer in 3 s"), 3000)),
  ]);
  // A connection that the peer's error closed rejects `closed` with that error.
  if (!next.startsWith("headers 204")) {
    await Promise.race([client.closed.catch(() => {}), new Promise(resolve => setTimeout(resolve, 2000))]);
  }
  if (!client.destroyed) client.close().catch(() => {});
  await endpoint.close?.().catch?.(() => {});
  return `first: ${first} | next: ${next}${sessionError ? ` | session: ${sessionError}` : ""}`;
}

const watchdog = setTimeout(() => {
  console.log(JSON.stringify({ timeout: true }));
  process.exit(2);
}, 180_000);
const kinds = {};
let connectionLost = 0;
for (let i = 0; i < runs; i++) {
  const result = await run();
  kinds[result] = (kinds[result] ?? 0) + 1;
  if (!result.includes("next: headers 204")) connectionLost++;
}
clearTimeout(watchdog);
console.log(JSON.stringify({ runs, fields, valueBytes, bodyBytes, connectionLost, kinds }, null, 1));
process.exit(0);
