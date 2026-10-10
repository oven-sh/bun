// Liveness probe 2. A client behind a UDP relay sends a datagram each PERIOD_MS, for the whole run.
// It also has stream data in flight when an outage starts. The outage lasts OUTAGE_MS and then ends.
// The server sends nothing of its own.
// Question: after the outage ends, does the server get the stream data and new datagrams, and when?
import { createPrivateKey } from "node:crypto";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { connect, listen } from "node:quic";
const keys = "/workspace/bun/test/js/node/test/fixtures/keys/";
const key = createPrivateKey(readFileSync(keys + "agent1-key.pem"));
const cert = readFileSync(keys + "agent1-cert.pem");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const PERIOD_MS = Number(process.env.PERIOD_MS ?? 20);
const BURST = Number(process.env.BURST ?? 1);
const SIZE = Number(process.env.SIZE ?? 700);
const OUTAGE_MS = Number(process.env.OUTAGE_MS ?? 4000);
const WAIT_MS = Number(process.env.WAIT_MS ?? 15000);
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 0);
const t0 = performance.now();
const now = () => Math.round(performance.now() - t0);

let receivedCount = 0;
let lastReceivedAt = -1;
let firstAfterOutageAt = -1;
let streamBytes = 0;
let streamAt = -1;
let outageEnd = -1;
const server = await listen(
  session => {
    session.onerror = () => {};
    session.closed.catch(() => {});
    session.onstream = async stream => {
      stream.closed.catch(() => {});
      try {
        for await (const batch of stream)
          for (const chunk of [batch].flat()) {
            streamBytes += chunk.byteLength;
            if (streamAt < 0) streamAt = now();
          }
      } catch {}
    };
  },
  {
    alpn: ["dbs"],
    sni: { "*": { keys: [key], certs: [cert] } },
    transportParams: { maxIdleTimeout: 60 },
    ondatagram() {
      receivedCount++;
      lastReceivedAt = now();
      if (outageEnd >= 0 && firstAfterOutageAt < 0) firstAfterOutageAt = now();
    },
  },
);
const front = createSocket("udp4");
const up = createSocket("udp4");
let clientPort = 0;
let outage = false;
const clientPacketTimes = [];
up.on("message", packet => void (outage || front.send(packet, clientPort, "127.0.0.1")));
front.on("message", (packet, from) => {
  clientPort = from.port;
  clientPacketTimes.push([now(), packet.length, outage ? "dropped" : "passed"]);
  if (!outage) up.send(packet, server.address.port, "127.0.0.1");
});
front.bind(0, "127.0.0.1");
up.bind(0, "127.0.0.1");
await Promise.all([once(front, "listening"), once(up, "listening")]);

const counts = { acknowledged: 0, lost: 0, abandoned: 0 };
const client = await connect(
  { address: "127.0.0.1", port: front.address().port },
  {
    alpn: "dbs",
    servername: "localhost",
    verifyPeer: "manual",
    transportParams: { maxIdleTimeout: 60 },
    onerror() {},
    ondatagramstatus(_id, status) {
      counts[status]++;
    },
  },
);
let closedAt = -1;
client.closed.then(
  () => (closedAt = now()),
  () => (closedAt = now()),
);
await client.opened;
let sentCalls = 0;
const timer = setInterval(() => {
  if (closedAt >= 0) return;
  for (let i = 0; i < BURST; i++) {
    client.sendDatagram(Buffer.alloc(SIZE, 1));
    sentCalls++;
  }
}, PERIOD_MS);
await sleep(500 + SETTLE_MS);

outage = true;
const outageStart = now();
const stream = await client.createBidirectionalStream();
stream.closed.catch(() => {});
stream.writer.writeSync(new Uint8Array(64));
await sleep(OUTAGE_MS);
outage = false;
outageEnd = now();

const deadline = performance.now() + WAIT_MS;
while ((streamBytes < 64 || firstAfterOutageAt < 0) && performance.now() < deadline && closedAt < 0) await sleep(20);
await sleep(300);
clearInterval(timer);
const { datagramsSent: sent, datagramsAcknowledged: acknowledged, datagramsLost: lost } = client.stats;
const during = clientPacketTimes.filter(([t]) => t >= outageStart && t < outageEnd);
console.log(
  JSON.stringify({
    PERIOD_MS,
    BURST,
    outageStart,
    outageEnd,
    streamAfterOutageEndMs: streamAt < 0 ? null : streamAt - outageEnd,
    firstDatagramAfterOutageEndMs: firstAfterOutageAt < 0 ? null : firstAfterOutageAt - outageEnd,
    closedAt,
    sentCalls,
    receivedCount,
    counts,
    stats: `${sent}/${acknowledged}/${lost}`,
    packetsDuringOutage: during.length,
    lastPacketsDuringOutage: during.slice(-8),
    clientPacketsAfterOutage: clientPacketTimes.filter(([t]) => t >= outageEnd).slice(0, 10),
  }),
);
process.exit(streamBytes >= 64 && firstAfterOutageAt >= 0 ? 0 : 1);
