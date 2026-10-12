// Read-only review probe: a 0-RTT client whose DATAGRAM packet is kept by lsquic BEFORE the
// handshake completes (refused send pauses the engine), while its Initial is lost.
// Which RETX alarm does the patch arm, and in which mode does it ring?
//
// Env:
//   SERVER_BIN      binary for the server process (default: same as this process)
//   EARLY_STREAM=1  write 0-RTT stream data in the first flight (a retransmittable APP packet)
//   PAUSE_MS        how long the engine stays paused by a refused send (dead connect), 0 = no pause
//   OUTAGE_MS       how long the relay drops packets, counted from the connect
//   DIRECTION       both: the relay drops client->server packets; s2c: it drops only server->client packets
//   WAIT_INITS      the pause starts once the relay has seen this many Initial packets
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { connect } from "node:quic";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const EARLY_STREAM = process.env.EARLY_STREAM === "1";
const PAUSE_MS = Number(process.env.PAUSE_MS ?? 4000);
const OUTAGE_MS = Number(process.env.OUTAGE_MS ?? 5000);
const DIRECTION = process.env.DIRECTION ?? "both";
const WAIT_INITS = Number(process.env.WAIT_INITS ?? 2);
const DEAD = process.env.DEAD ?? "192.0.2.1";
const t0 = Date.now();
const now = () => Date.now() - t0;
const mark = text => console.error(`@@PROBE ${now()}ms ${text}`);

const serverProc = Bun.spawn({
  cmd: [process.env.SERVER_BIN ?? process.execPath, "/tmp/pns_probe/server.mjs"],
  env: { ...process.env, BUN_DEBUG_lsquic: undefined, BUN_DEBUG_QUIET_LOGS: "1" },
  stdin: "pipe",
  stdout: "pipe",
  stderr: "ignore",
});
const received = [];
let streamBytes = 0;
let serverPort = 0;
const gotPort = Promise.withResolvers();
(async () => {
  let buffered = "";
  for await (const chunk of serverProc.stdout) {
    buffered += new TextDecoder().decode(chunk);
    let nl;
    while ((nl = buffered.indexOf("\n")) >= 0) {
      const [kind, at, value, extra] = buffered.slice(0, nl).split(" ");
      buffered = buffered.slice(nl + 1);
      if (kind === "PORT") gotPort.resolve(Number(at));
      else if (kind === "DG") received.push([Number(at) - t0, Number(value), extra]);
      else if (kind === "STREAM") streamBytes += Number(value);
    }
  }
})();
serverPort = await gotPort.promise;

const front = createSocket("udp4");
const up = createSocket("udp4");
let clientPort = 0;
let outage = false;
let serverPacketsDropped = 0;
let initialsSeen = 0;
let onInitial = () => {};
const clientPackets = [];
up.on("message", packet => {
  if (outage && DIRECTION === "s2c") {
    serverPacketsDropped++;
    return;
  }
  front.send(packet, clientPort, "127.0.0.1");
});
front.on("message", (packet, from) => {
  clientPort = from.port;
  const v2 = packet.length > 5 && packet.readUInt32BE(1) === 0x6b3343cf;
  const kind = packet[0] & 0x80
    ? (v2 ? ["retry", "initial", "0rtt", "handshake"] : ["initial", "0rtt", "handshake", "retry"])[(packet[0] >> 4) & 3]
    : "short";
  const dropped = outage && DIRECTION !== "s2c";
  clientPackets.push([now(), packet.length, kind, dropped ? "dropped" : "passed"]);
  if (kind === "initial") {
    initialsSeen++;
    onInitial();
  }
  if (!dropped) up.send(packet, serverPort, "127.0.0.1");
});
front.bind(0, "127.0.0.1");
up.bind(0, "127.0.0.1");
await Promise.all([once(front, "listening"), once(up, "listening")]);
const relay = { address: "127.0.0.1", port: front.address().port };

const ticket = Promise.withResolvers();
const token = Promise.withResolvers();
const first = await connect(relay, {
  alpn: "quic-test",
  servername: "localhost",
  verifyPeer: "manual",
  onsessionticket: ticket.resolve,
  onnewtoken: token.resolve,
});
await Promise.all([first.opened, ticket.promise, token.promise]);
await first.close();
await sleep(100);
clientPackets.length = 0;
initialsSeen = 0;
received.length = 0;

mark("0-RTT connect, outage starts");
outage = true;
const outageStart = now();
const statuses = {};
const client = await connect(relay, {
  alpn: "quic-test",
  servername: "localhost",
  verifyPeer: "manual",
  sessionTicket: await ticket.promise,
  token: await token.promise,
  transportParams: { maxIdleTimeout: 30 },
  onerror() {},
  onearlyrejected() {},
  ondatagramstatus(id, status) {
    statuses[id] = [now(), status];
  },
});
let closedAt = -1;
let closeError = null;
client.closed.then(
  () => (closedAt = now()),
  error => {
    closedAt = now();
    closeError = String(error);
  },
);
let openedAt = -1;
let early = null;
client.opened.then(
  info => {
    openedAt = now();
    early = { attempted: info.earlyDataAttempted, accepted: info.earlyDataAccepted };
  },
  () => {},
);
if (EARLY_STREAM) {
  const stream = await client.createBidirectionalStream();
  stream.closed.catch(() => {});
  stream.writer.writeSync(new Uint8Array(64));
  mark("early stream data written");
}
// Datagram id 1 leaves with the first flight (not kept).
client.sendDatagram(Buffer.alloc(300, 1));
await new Promise(resolve => {
  onInitial = () => initialsSeen >= WAIT_INITS && resolve();
  onInitial();
});
mark(`relay saw ${initialsSeen} Initial packets`);

let dead;
if (PAUSE_MS > 0) {
  mark("dead connect: the engine pauses");
  try {
    dead = await connect(
      { address: DEAD, port: 443 },
      { alpn: "quic-test", servername: "localhost", verifyPeer: "manual", onerror() {} },
    );
    dead.closed.catch(() => {});
    dead.opened.catch(() => {});
  } catch (e) {
    console.error("connect to refused address threw:", String(e));
  }
  await sleep(10);
}
// Datagram id 2 (payload byte 10) is framed while the engine cannot send.
client.sendDatagram(Buffer.alloc(300, 10));
mark("datagram id 2 (byte 10) handed to sendDatagram");
if (PAUSE_MS > 0) {
  await sleep(PAUSE_MS);
  mark("dead destroy: the pause may end");
  try {
    dead?.destroy();
  } catch (e) {
    console.error("destroy threw:", String(e));
  }
}
const leftOutage = OUTAGE_MS - (now() - outageStart);
if (leftOutage > 0) await sleep(leftOutage);
mark("outage ends");
outage = false;
const outageEnd = now();
const deadline = Date.now() + 15000;
while (openedAt < 0 && closedAt < 0 && Date.now() < deadline) await sleep(20);
mark(`opened=${openedAt} closed=${closedAt}`);
if (openedAt >= 0) {
  // Datagram ids 3 to 6 (bytes 50 to 53) after the handshake.
  for (let i = 0; i < 4; i++) {
    client.sendDatagram(Buffer.alloc(300, 50 + i));
    await sleep(30);
  }
  const until = Date.now() + 6000;
  while (Date.now() < until && !(received.some(([, r]) => r === 53) && Object.keys(statuses).length >= 6)) await sleep(20);
  await sleep(300);
}
const { datagramsSent: sent, datagramsAcknowledged: acknowledged, datagramsLost: lost } = client.stats;
console.log(
  JSON.stringify({
    EARLY_STREAM,
    DIRECTION,
    PAUSE_MS,
    OUTAGE_MS,
    serverPacketsDropped,
    outageStart,
    outageEnd,
    openedAt,
    closedAt,
    closeError,
    early,
    received,
    streamBytes,
    statuses,
    stats: `${sent}/${acknowledged}/${lost}`,
    clientPackets,
  }),
);
serverProc.kill();
process.exit(0);
