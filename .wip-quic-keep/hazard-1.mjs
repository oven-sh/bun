// Liveness probe. A client behind a UDP relay has stream data in flight when an outage starts.
// Its RTO fires. It sends N datagrams during the outage and then sends nothing more.
// The outage lasts OUTAGE_MS after the RTO and then ends. Nothing else is sent by the app.
// Question: how long after the end of the outage does the server get the stream data?
import { createPrivateKey } from "node:crypto";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { connect, listen } from "node:quic";
const keys = "/workspace/bun/test/js/node/test/fixtures/keys/";
const key = createPrivateKey(readFileSync(keys + "agent1-key.pem"));
const cert = readFileSync(keys + "agent1-cert.pem");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const N = Number(process.env.N ?? 3);
const OUTAGE_MS = Number(process.env.OUTAGE_MS ?? 1500);
const WAIT_MS = Number(process.env.WAIT_MS ?? 20000);
const t0 = performance.now();
const now = () => Math.round(performance.now() - t0);

const received = [];
let streamBytes = 0;
let streamAt = -1;
const datagramAt = {};
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
    ondatagram(datagram) {
      received.push(datagram[0]);
      datagramAt[datagram[0]] = now();
    },
  },
);
const front = createSocket("udp4");
const up = createSocket("udp4");
let clientPort = 0;
let outage = false;
let clientPackets = 0;
const clientPacketTimes = [];
up.on("message", packet => void (outage || front.send(packet, clientPort, "127.0.0.1")));
front.on("message", (packet, from) => {
  clientPort = from.port;
  clientPackets++;
  clientPacketTimes.push([now(), packet.length, outage ? "dropped" : "passed"]);
  if (!outage) up.send(packet, server.address.port, "127.0.0.1");
});
front.bind(0, "127.0.0.1");
up.bind(0, "127.0.0.1");
await Promise.all([once(front, "listening"), once(up, "listening")]);

const statuses = {};
const statusAt = {};
let onStatus = () => {};
const client = await connect(
  { address: "127.0.0.1", port: front.address().port },
  {
    alpn: "dbs",
    servername: "localhost",
    verifyPeer: "manual",
    transportParams: { maxIdleTimeout: 60 },
    onerror() {},
    ondatagramstatus(id, status) {
      statuses[id] = status;
      statusAt[id] = now();
      onStatus();
    },
  },
);
let closedAt = -1;
client.closed.then(
  () => (closedAt = now()),
  () => (closedAt = now()),
);
await client.opened;
for (let i = 1; i <= 8; i++) {
  await client.sendDatagram(Buffer.alloc(700, i));
  await sleep(30);
}

if (process.env.MODE === "idle") {
  // The connection is idle while it settles. Two datagrams then start a path MTU probe, which the outage loses.
  await sleep(Number(process.env.SETTLE_MS ?? 0));
  for (let i = 0; i < 2; i++) {
    await client.sendDatagram(Buffer.alloc(700, 99));
    await sleep(30);
  }
} else {
  // A datagram each 20 ms while the connection settles: NEW_CONNECTION_ID frames and the path MTU search end here.
  const until = performance.now() + Number(process.env.SETTLE_MS ?? 0);
  while (performance.now() < until) {
    await client.sendDatagram(Buffer.alloc(700, 99));
    await sleep(20);
  }
  await sleep(400);
}
outage = true;
const outageStart = now();
await client.sendDatagram(Buffer.alloc(700, 9));
const stream = await client.createBidirectionalStream();
stream.closed.catch(() => {});
stream.writer.writeSync(new Uint8Array(64));
await new Promise(resolve => (onStatus = () => statuses[9] && resolve()));
await new Promise(resolve => setImmediate(resolve));
const rtoAt = now();
for (let i = 10; i < 10 + N; i++) client.sendDatagram(Buffer.alloc(700, i));
await sleep(OUTAGE_MS);
outage = false;
const outageEnd = now();
const packetsAtEnd = clientPackets;

// Nothing more from the app. Wait for the stream data.
const deadline = performance.now() + WAIT_MS;
while (streamBytes < 64 && performance.now() < deadline && closedAt < 0) await sleep(20);
const { datagramsSent: sent, datagramsAcknowledged: acknowledged, datagramsLost: lost } = client.stats;
console.log(
  JSON.stringify({
    N,
    outageStart,
    rtoAt,
    outageEnd,
    streamAfterOutageEndMs: streamAt < 0 ? null : streamAt - outageEnd,
    closedAt,
    received,
    statuses,
    stats: `${sent}/${acknowledged}/${lost}`,
    clientPacketsDuringOutageAfterRto: clientPacketTimes.filter(([t]) => t >= rtoAt && t < outageEnd),
    clientPacketsAfterOutage: clientPacketTimes.filter(([t]) => t >= outageEnd).slice(0, 12),
  }),
);
process.exit(streamBytes >= 64 ? 0 : 1);
