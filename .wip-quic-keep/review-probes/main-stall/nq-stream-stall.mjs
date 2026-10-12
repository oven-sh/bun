// Release-stall probe for node:quic. No datagram is sent at any point: only reliable stream data.
// A client behind a UDP relay writes small stream chunks until its path MTU search starts (the relay
// sees the first packet larger than 1400 bytes). Then an outage starts (MODE=blackout), or the relay
// has dropped large client packets from the start and the outage starts START_MS later (MODE=mtu).
// At the start of the outage the client writes REQ_BYTES on a second stream and then writes nothing more.
// The outage lasts OUTAGE_MS and ends. Question: when does the server get the REQ_BYTES?
import { createPrivateKey } from "node:crypto";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { connect, listen } from "node:quic";
const keys = "/workspace/bun/test/js/node/test/fixtures/keys/";
const key = createPrivateKey(readFileSync(keys + "agent1-key.pem"));
const cert = readFileSync(keys + "agent1-cert.pem");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const MODE = process.env.MODE ?? "blackout";
const OUTAGE_MS = Number(process.env.OUTAGE_MS ?? 7000);
const WAIT_MS = Number(process.env.WAIT_MS ?? 20000);
const IDLE_S = Number(process.env.IDLE_S ?? 60);
const MTU_DROP = Number(process.env.MTU_DROP ?? (MODE === "mtu" ? 1400 : 0));
const START_MS = Number(process.env.START_MS ?? (MODE === "control" ? 2500 : 500));
const REQ_BYTES = Number(process.env.REQ_BYTES ?? 64);
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 9000);
const t0 = performance.now();
const now = () => Math.round(performance.now() - t0);

let warmBytes = 0;
let reqBytes = 0;
let reqAt = -1;
let streams = 0;
const server = await listen(
  session => {
    session.onerror = () => {};
    session.closed.catch(() => {});
    session.onstream = async stream => {
      const index = streams++;
      stream.closed.catch(() => {});
      try {
        for await (const batch of stream)
          for (const chunk of [batch].flat()) {
            if (index === 0) warmBytes += chunk.byteLength;
            else {
              reqBytes += chunk.byteLength;
              if (reqBytes >= REQ_BYTES && reqAt < 0) reqAt = now();
            }
          }
      } catch {}
    };
  },
  {
    alpn: ["rst"],
    sni: { "*": { keys: [key], certs: [cert] } },
    transportParams: { maxIdleTimeout: IDLE_S },
  },
);
const front = createSocket("udp4");
const up = createSocket("udp4");
let clientPort = 0;
let outage = false;
let probeSeenAt = -1;
let onProbe = () => {};
const clientPackets = [];
const serverPackets = [];
up.on("message", packet => {
  serverPackets.push([now(), packet.length, outage ? "dropped" : "passed"]);
  if (!outage) front.send(packet, clientPort, "127.0.0.1");
});
front.on("message", (packet, from) => {
  clientPort = from.port;
  const large = packet.length > 1400;
  if (large && probeSeenAt < 0) {
    probeSeenAt = now();
    if (MODE === "blackout") outage = true;
    onProbe();
  }
  const dropped = outage || (MTU_DROP > 0 && packet.length > MTU_DROP);
  clientPackets.push([now(), packet.length, dropped ? "dropped" : "passed"]);
  if (!dropped) up.send(packet, server.address.port, "127.0.0.1");
});
front.bind(0, "127.0.0.1");
up.bind(0, "127.0.0.1");
await Promise.all([once(front, "listening"), once(up, "listening")]);

const client = await connect(
  { address: "127.0.0.1", port: front.address().port },
  {
    alpn: "rst",
    servername: "localhost",
    verifyPeer: "manual",
    transportParams: { maxIdleTimeout: IDLE_S },
    onerror() {},
  },
);
let closedAt = -1;
client.closed.then(
  () => (closedAt = now()),
  () => (closedAt = now()),
);
await client.opened;

// Warm-up: a few small chunks, then the connection settles (NEW_CONNECTION_ID frames end here),
// then one small chunk each 10 ms on the first stream, until the path MTU search starts.
const warm = await client.createBidirectionalStream();
warm.closed.catch(() => {});
let warmWritten = 0;
for (let i = 0; i < 4; i++) {
  warm.writer.writeSync(new Uint8Array(32));
  warmWritten += 32;
  await sleep(30);
}
await sleep(SETTLE_MS);
const probeSeen = new Promise(resolve => (onProbe = resolve));
let probed = false;
probeSeen.then(() => (probed = true));
while (!probed && warmWritten < 400 * 32) {
  warm.writer.writeSync(new Uint8Array(32));
  warmWritten += 32;
  await sleep(10);
}
if (!probed) {
  console.log(JSON.stringify({ error: "no MTU probe seen", warmWritten, clientPackets: clientPackets.length }));
  process.exit(2);
}
if (MODE === "mtu" || MODE === "control") {
  // MODE=control: the first probe passed, so the path MTU search ends before the outage starts.
  await sleep(START_MS);
  outage = true;
}
const outageStart = now();
const request = await client.createBidirectionalStream();
request.closed.catch(() => {});
request.writer.writeSync(new Uint8Array(REQ_BYTES));
await sleep(OUTAGE_MS);
outage = false;
const outageEnd = now();

// Nothing more from the app. Wait for the request bytes at the server.
const deadline = performance.now() + WAIT_MS;
while (reqBytes < REQ_BYTES && performance.now() < deadline && closedAt < 0) await sleep(20);
const waitedMs = now() - outageEnd;
console.log(
  JSON.stringify({
    MODE,
    MTU_DROP,
    OUTAGE_MS,
    IDLE_S,
    probeSeenAt,
    outageStart,
    outageEnd,
    requestAfterOutageEndMs: reqAt < 0 ? null : reqAt - outageEnd,
    waitedMs,
    closedAt,
    warmWritten,
    warmBytes,
    reqBytes,
    clientPacketsInOutage: clientPackets.filter(([t]) => t >= outageStart && t < outageEnd),
    clientPacketsAfterOutage: clientPackets.filter(([t]) => t >= outageEnd).slice(0, 12),
    serverPacketsInOutage: serverPackets.filter(([t]) => t >= outageStart && t < outageEnd),
    serverPacketsAfterOutage: serverPackets.filter(([t]) => t >= outageEnd).slice(0, 8),
  }),
);
process.exit(reqBytes >= REQ_BYTES ? 0 : 1);
