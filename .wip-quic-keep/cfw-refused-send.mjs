// Probe (read-only analysis, class-and-free-wins): the refused-send sibling.
// A live node:quic session on the default client endpoint. A second connect() on the same endpoint goes to
// an address that the kernel refuses (192.0.2.1 from a socket bound to 127.0.0.1: EINVAL), so packets_out
// reports EAGAIN and lsquic pauses the engine. The live session sends datagrams during the pause.
// Then the refused session is destroyed. Question: do the datagrams of the pause reach the server?
import { createPrivateKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { connect, listen } from "node:quic";
const keys = "/workspace/bun/test/js/node/test/fixtures/keys/";
const key = createPrivateKey(readFileSync(keys + "agent1-key.pem"));
const cert = readFileSync(keys + "agent1-cert.pem");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const DEAD = process.env.DEAD ?? "192.0.2.1";
const N = Number(process.env.N ?? 5);
const PAUSE_MS = Number(process.env.PAUSE_MS ?? 300);

const received = [];
const server = await listen(
  session => {
    session.onerror = () => {};
    session.closed.catch(() => {});
  },
  {
    alpn: ["dbs"],
    sni: { "*": { keys: [key], certs: [cert] } },
    transportParams: { maxIdleTimeout: 30 },
    ondatagram(datagram) {
      received.push(datagram[0]);
    },
  },
);
const statuses = {};
const client = await connect(
  { address: "127.0.0.1", port: server.address.port },
  {
    alpn: "dbs",
    servername: "localhost",
    verifyPeer: "manual",
    transportParams: { maxIdleTimeout: 30 },
    onerror() {},
    ondatagramstatus(id, status) {
      statuses[id] = status;
    },
  },
);
client.closed.catch(() => {});
await client.opened;
for (let i = 1; i <= 8; i++) {
  await client.sendDatagram(Buffer.alloc(700, i));
  await sleep(30);
}
await sleep(300);

const sentBefore = client.stats.datagramsSent;
let dead;
try {
  dead = await connect(
    { address: DEAD, port: 443 },
    { alpn: "dbs", servername: "localhost", verifyPeer: "manual", onerror() {} },
  );
  dead.closed.catch(() => {});
  dead.opened.catch(() => {});
} catch (e) {
  console.error("connect to refused address threw:", String(e));
}
await sleep(30);
const sentDuringPause = [];
const idOf = {};
for (let i = 10; i < 10 + N; i++) {
  const id = Number(await client.sendDatagram(Buffer.alloc(700, i)));
  sentDuringPause.push(i);
  idOf[i] = id;
  await sleep(Math.max(1, Math.floor(PAUSE_MS / N)));
}
const statusesAtEndOfPause = { ...statuses };
const sentStatAtEndOfPause = String(client.stats.datagramsSent);
const sentStatBeforePause = String(sentBefore);
try {
  dead?.destroy();
} catch (e) {
  console.error("destroy threw:", String(e));
}
await sleep(2500);
const { datagramsSent: sent, datagramsAcknowledged: acknowledged, datagramsLost: lost } = client.stats;
const arrived = sentDuringPause.filter(id => received.includes(id));
console.log(
  JSON.stringify({
    dead: DEAD,
    sentDuringPause,
    arrived,
    statusesOfPause: Object.fromEntries(sentDuringPause.map(i => [i, statuses[idOf[i]] ?? null])),
    statusesAtEndOfPause: Object.fromEntries(sentDuringPause.map(i => [i, statusesAtEndOfPause[idOf[i]] ?? null])),
    stats: `${sent}/${acknowledged}/${lost}`,
    sentStatBeforePause,
    sentStatAtEndOfPause,
  }),
);
process.exit(arrived.length === sentDuringPause.length ? 0 : 1);
