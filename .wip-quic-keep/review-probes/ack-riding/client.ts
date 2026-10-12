// Scratch probe (round 5): recovery after an outage when the peer keeps
// sending.  The client, the relay and the measurements live here; the server
// is a child process.  stderr of this process is the client's lsquic log.
import { createPrivateKey } from "node:crypto";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { connect } from "node:quic";

const LARGE = 1100,
  SMALL = 200;
const MODE = process.env.MODE ?? "dgram"; // dgram | stream | respond
const DIR = process.env.DIR ?? "both"; // both | up
const OUTAGE_MS = Number(process.env.OUTAGE_MS ?? 1400);
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 0);
const POST_MS = Number(process.env.POST_MS ?? 4000);
const CLIENT_DGRAM_MS = Number(process.env.CLIENT_DGRAM_MS ?? 20);
const abs = () => performance.timeOrigin + performance.now();
const hms = (t = abs()) => {
  const d = new Date(t);
  const us = Math.floor((t % 1000) * 1000)
    .toString()
    .padStart(6, "0");
  return d.toISOString().slice(11, 19) + "." + us;
};
const mark = (name: string) => {
  const t = abs();
  process.stderr.write(`MARK ${name} ${hms(t)}\n`);
  return t;
};

// The server: same binary, no lsquic log.
const env: Record<string, string> = { ...(process.env as any) };
delete env.BUN_DEBUG_lsquic;
const child = Bun.spawn({
  cmd: [process.execPath, "/tmp/_r5/server.ts"],
  env,
  stdout: "pipe",
  stderr: "ignore",
});
const received: [number, number][] = [];
const serverStream: [number, number][] = [];
const gotPort = Promise.withResolvers<number>();
(async () => {
  let buf = "";
  const dec = new TextDecoder();
  for await (const chunk of child.stdout) {
    buf += dec.decode(chunk, { stream: true });
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (!line.startsWith("{")) continue;
      const o = JSON.parse(line);
      if (o.ev === "listening") gotPort.resolve(o.port);
      else if (o.ev === "dg") received.push([o.id, o.t]);
      else if (o.ev === "stream") serverStream.push([o.n, o.t]);
    }
  }
})();
const serverPort = await gotPort.promise;

const front = createSocket("udp4");
const upstream = createSocket("udp4");
let clientPort = 0;
const relay = { lose: (_p: Buffer) => false, dropServer: false, onClientPacket: (_p: Buffer) => {} };
const RELAY_DELAY_MS = Number(process.env.RELAY_DELAY_MS ?? 0); // one-way delay; a packet is lost when it reaches the relay in the outage
upstream.on("message", packet => {
  if (relay.dropServer) return;
  if (RELAY_DELAY_MS > 0) setTimeout(() => front.send(packet, clientPort, "127.0.0.1"), RELAY_DELAY_MS);
  else front.send(packet, clientPort, "127.0.0.1");
});
front.on("message", (packet, from) => {
  clientPort = from.port;
  relay.onClientPacket(packet);
  if (relay.lose(packet)) return;
  if (RELAY_DELAY_MS > 0) setTimeout(() => upstream.send(packet, serverPort, "127.0.0.1"), RELAY_DELAY_MS);
  else upstream.send(packet, serverPort, "127.0.0.1");
});
front.bind(0, "127.0.0.1");
upstream.bind(0, "127.0.0.1");
await Promise.all([once(front, "listening"), once(upstream, "listening")]);

const statuses = new Map<number, string>();
const statusAt = new Map<number, number>();
let onStatus = () => {};
let fromServer = 0;
let afterEnd = false;
let respond = () => {};
const client = await connect(
  { address: "127.0.0.1", port: front.address().port },
  {
    alpn: "quic-test",
    servername: "localhost",
    verifyPeer: "manual",
    transportParams: { maxIdleTimeout: 30 },
    onerror() {},
    ondatagram() {
      fromServer++;
      if (MODE === "respond" && afterEnd) respond();
    },
    ondatagramstatus(id: bigint, status: string) {
      if (!statuses.has(Number(id))) {
        statuses.set(Number(id), status);
        statusAt.set(Number(id), abs());
      }
      onStatus();
    },
  },
);
await client.opened;

let nextId = 0;
const sentAt = new Map<number, number>();
const send = (size = LARGE) => {
  const id = ++nextId;
  const b = Buffer.alloc(size);
  b.writeUInt16LE(id, 0);
  sentAt.set(id, abs());
  client.sendDatagram(b);
  return id;
};
const status = (id: number) =>
  new Promise<string>(resolve => {
    const check = () => statuses.has(id) && resolve(statuses.get(id)!);
    onStatus = check;
    check();
  });

const stream = await client.createBidirectionalStream();
stream.closed.catch(() => {});
const echoes: [number, number][] = [];
let echoed = 0;
(async () => {
  try {
    for await (const batch of stream) {
      for (const chunk of [batch].flat()) echoed += chunk.byteLength;
      echoes.push([echoed, abs()]);
    }
  } catch {}
})();
const write = (n: number) => void stream.writer.writeSync(new Uint8Array(n));
let responded = 0;
respond = () => {
  if (responded++ === 0) {
    mark("RESPOND");
    write(16);
  }
};

// Warm-up, as the test file does it.
for (let i = 0; i < 24; i += 2) {
  send();
  await status(send());
}
write(8);
while (echoed < 8) await new Promise(r => setTimeout(r, 5));
const CONT = process.env.CONT === "1"; // the client's 20 ms sender runs into the outage without a pause
let contTimer: any = null;
if (SETTLE_MS > 0) {
  // A connection in its steady state: datagrams both ways, nothing else.
  const t = setInterval(() => send(SMALL), CLIENT_DGRAM_MS);
  await new Promise(r => setTimeout(r, SETTLE_MS));
  if (CONT) contTimer = t;
  else {
    clearInterval(t);
    await new Promise(r => setTimeout(r, 100));
  }
}

// Outage.
relay.lose = () => true;
relay.dropServer = DIR === "both";
mark("OUTAGE");
const inOutage = send();
await new Promise<void>(resolve => (relay.onClientPacket = () => resolve()));
relay.onClientPacket = () => {};
write(64);
const st = await status(inOutage); // the first RTO declared it lost
const t0 = mark("T0");
await new Promise<void>(resolve => setImmediate(resolve));
const a = send();
const b = send();
const firstPeriodic = nextId + 1;
const clientTimer = contTimer ?? setInterval(() => send(SMALL), CLIENT_DGRAM_MS);

await new Promise(r => setTimeout(r, OUTAGE_MS));
relay.lose = () => false;
relay.dropServer = false;
const tEnd = mark("TEND");
afterEnd = true;
const echoedAtEnd = echoed;
const fromServerAtEnd = fromServer;
if (MODE === "stream")
  setTimeout(() => {
    mark("WRITE");
    write(64);
  }, 30);

await new Promise(r => setTimeout(r, POST_MS));
clearInterval(clientTimer);
mark("DONE");

const after = received.filter(([, t]) => t >= tEnd);
const firstAfter = after.length ? Math.round(after[0][1] - tEnd) : null;
const echoAfter = echoes.find(([n, t]) => t >= tEnd && n > echoedAtEnd);
const firstStreamAtServer = serverStream.find(([, t]) => t >= tEnd);
// age of each datagram on arrival (ms), for those delivered after the end
const ages = after.map(([id, t]) => Math.round(t - (sentAt.get(id) ?? t)));
const sentBetween = [...sentAt.entries()].filter(([, t]) => t >= t0 && t < tEnd).map(([id]) => id);
const deliveredOfOutage = sentBetween.filter(id => received.some(([r]) => r === id)).length;
console.log(
  JSON.stringify({
    mode: MODE,
    dir: DIR,
    settle: SETTLE_MS, cont: CONT, relayDelay: RELAY_DELAY_MS,
    inOutageStatus: st,
    outageMs: Math.round(tEnd - t0),
    firstClientDatagramAfterEndMs: firstAfter,
    firstIdAfter: after[0]?.[0] ?? null,
    a,
    b,
    firstPeriodic,
    deliveredIn100ms: after.filter(([, t]) => t < tEnd + 100).length,
    deliveredIn500ms: after.filter(([, t]) => t < tEnd + 500).length,
    deliveredIn1000ms: after.filter(([, t]) => t < tEnd + 1000).length,
    deliveredTotalAfter: after.length,
    sentInOutage: sentBetween.length,
    deliveredOfOutage,
    maxAgeMs: ages.length ? Math.max(...ages) : null,
    streamAtServerAfterEndMs: firstStreamAtServer ? Math.round(firstStreamAtServer[1] - tEnd) : null,
    streamEchoAfterEndMs: echoAfter ? Math.round(echoAfter[1] - tEnd) : null,
    serverDatagramsSeenAfterEnd: fromServer - fromServerAtEnd,
    stats: {
      sent: String(client.stats.datagramsSent),
      acked: String(client.stats.datagramsAcknowledged),
      lost: String(client.stats.datagramsLost),
    },
    abandoned: [...statuses.values()].filter(s => s === "abandoned").length,
  }),
);
child.kill();
process.exit(0);
