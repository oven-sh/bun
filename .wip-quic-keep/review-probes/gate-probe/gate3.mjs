// Read-only probe for the review: which packets does the post-RTO gate of lsquic hold with no timer?
//
// Sequence (no debugger, relay only):
//   1. warm-up in pairs of datagrams
//   2. stream chunk L, then datagrams Da, Db: all reach the server. The server's ACKs are delayed (held by the relay).
//      From Db on, the uplink is held too.
//   3. client: TLP, TLP, RTO: L is retransmitted (L'''), Da/Db are destroyed ('lost').
//   4. one datagram after the RTO uses the second post-RTO slot; the relay loses it.
//   5. the delayed ACKs arrive (largest acked = Db, which the RTO destroyed): the retransmission is acked through the
//      loss record, the RETX alarm is cleared, sc_n_consec_rtos stays 1 and sc_next_limit stays 0.
//   6. the path is healthy from here on. The app pauses PAUSE_MS, then sends one datagram every 50 ms.
// PROBES=1: the relay drops client packets longer than 1260 bytes (path MTU below 1472), so lsquic keeps probing.
// PROBES=0: big packets pass, the MTU converges during warm-up, no probe is pending in step 6.
import { createPrivateKey } from "node:crypto";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { connect, listen } from "node:quic";

const keys = "/workspace/bun/test/js/node/test/fixtures/keys/";
const key = createPrivateKey(readFileSync(keys + "agent1-key.pem"));
const cert = readFileSync(keys + "agent1-cert.pem");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const immediate = () => new Promise(resolve => setImmediate(resolve));
const PROBES = process.env.PROBES !== "0";
const IDLE = Number(process.env.IDLE ?? 8);
const PAUSE_MS = Number(process.env.PAUSE_MS ?? 1300);
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 9000);
const OBSERVE_MS = Number(process.env.OBSERVE_MS ?? (IDLE + 4) * 1000);
const DG = 300;
const CHUNK = 600;
const t0 = performance.now();
const now = () => Math.round(performance.now() - t0);
const log = (...a) => console.log(`[${String(now()).padStart(6)}]`, ...a);

const received = new Map(); // id -> time
let onReceived = () => {};
let serverSession;
const server = await listen(
  session => {
    serverSession = session;
    session.onerror = e => log("SERVER onerror", e?.code, e?.message);
    session.closed.then(
      () => log("SERVER closed resolved"),
      e => log("SERVER closed rejected", e?.code, e?.message),
    );
    session.onstream = async stream => {
      stream.closed.catch(() => {});
      try {
        for await (const _ of stream);
      } catch {}
    };
  },
  {
    alpn: ["gate"],
    sni: { "*": { keys: [key], certs: [cert] } },
    transportParams: { maxIdleTimeout: IDLE },
    ondatagram(datagram) {
      if (!received.has(datagram[0])) received.set(datagram[0], now());
      onReceived();
    },
  },
);

const front = createSocket("udp4");
const up = createSocket("udp4");
let clientPort = 0;
const relay = {
  holdUp: false,
  holdDown: false,
  loseDatagrams: 0,
  heldUp: [],
  heldDown: [],
  trace: false,
  lastBigAt: 0,
  onClient: () => {},
};
const kind = p =>
  p[0] & 0x80
    ? "long"
    : p.length > 1260
      ? "BIG" + p.length
      : p.length >= CHUNK && p.length < CHUNK + 100
        ? "CHUNK"
        : p.length >= DG && p.length < DG + 100
          ? "DG"
          : "s" + p.length;
up.on("message", packet => {
  if (relay.trace) log("  relay S->C", kind(packet), relay.holdDown ? "HELD" : "fwd");
  if (relay.holdDown) relay.heldDown.push(packet);
  else front.send(packet, clientPort, "127.0.0.1");
});
front.on("message", (packet, from) => {
  clientPort = from.port;
  const k = kind(packet);
  let action = "fwd";
  if (PROBES && k.startsWith("BIG")) action = "DROP(mtu)";
  else if (k === "DG" && relay.loseDatagrams > 0) {
    relay.loseDatagrams--;
    action = "LOSE";
  } else if (relay.holdUp) action = "HELD";
  if (k.startsWith("BIG")) relay.lastBigAt = now();
  if (relay.trace || k.startsWith("BIG")) log("  relay C->S", k, action);
  relay.onClient(k, action);
  if (action === "fwd") up.send(packet, server.address.port, "127.0.0.1");
  else if (action === "HELD") relay.heldUp.push(packet);
});
front.bind(0, "127.0.0.1");
up.bind(0, "127.0.0.1");
await Promise.all([once(front, "listening"), once(up, "listening")]);

const statuses = {};
let onStatus = () => {};
const client = await connect(
  { address: "127.0.0.1", port: front.address().port },
  {
    alpn: "gate",
    servername: "localhost",
    verifyPeer: "manual",
    transportParams: { maxIdleTimeout: IDLE },
    onerror(e) {
      log("CLIENT onerror", e?.code, e?.message);
    },
    ondatagramstatus(id, status) {
      statuses[id] = statuses[id] ? statuses[id] + "," + status : status;
      onStatus();
    },
  },
);
let clientClosedAt = 0;
client.closed.then(
  () => ((clientClosedAt = now()), log("CLIENT closed resolved")),
  e => ((clientClosedAt = now()), log("CLIENT closed rejected", e?.code, e?.message)),
);
await client.opened;
log("opened");

let nextId = 0;
const sentAt = {};
const send = () => {
  const id = ++nextId;
  sentAt[id] = now();
  client.sendDatagram(Buffer.alloc(DG, id)).catch?.(() => {});
  return id;
};
const status = id => new Promise(resolve => (onStatus = () => statuses[id] && resolve(statuses[id]), onStatus()));

// 1. warm-up in pairs: the server acknowledges every second packet at once.
for (let i = 0; i < 16; i++) {
  send();
  await status(send());
}
log("warm-up done, ids 1..", nextId);
const stream = await client.createBidirectionalStream();
stream.closed.catch(() => {});
stream.writer.writeSync(new Uint8Array(8));
// Let both sides finish issuing connection ids (one NEW_CONNECTION_ID per second), so that no retransmittable
// packet is in flight and the server has nothing of its own to send.
{
  const settleUntil = now() + SETTLE_MS;
  while (now() < settleUntil) {
    send();
    await status(send());
    await sleep(400);
  }
}
log("settled; stats", JSON.stringify({ sent: String(client.stats.datagramsSent), acked: String(client.stats.datagramsAcknowledged) }));

const COINCIDE = process.env.COINCIDE === "1";
if (COINCIDE) {
  // Start the spike right after lsquic generated a probe: the next probe is due one second later.
  const seen = relay.lastBigAt;
  while (relay.lastBigAt === seen) {
    send();
    await status(send());
    await sleep(20);
  }
  log("a probe just left; its successor is due at", relay.lastBigAt + 1000);
}
if (process.env.ALIGN_MS) {
  // Start the interruption ALIGN_MS after lsquic generated a probe, so that the next probe falls shortly after the RTO.
  const seen = relay.lastBigAt;
  while (relay.lastBigAt === seen) {
    send();
    await status(send());
    await sleep(20);
  }
  await sleep(Number(process.env.ALIGN_MS));
  log("interruption starts", now() - relay.lastBigAt, "ms after a probe; next probe due at", relay.lastBigAt + 1000);
}
// 2. the delay spike
relay.trace = true;
relay.holdDown = true;
log("STEP 2: downlink held; write L, then Da, Db");
// Db leaves after the two tail-loss probes of L, so that it is the newest packet the server has. The uplink is
// held from then on: what the client sends during the interruption is lost.
let chunks = 0;
let onChunk = () => {};
let dgs = 0;
let onDbPassed = () => {};
relay.onClient = k => {
  if (k === "CHUNK") {
    chunks++;
    onChunk();
  }
  if (k === "DG" && ++dgs === 2) {
    relay.holdUp = true;
    log("uplink held after Db");
    onDbPassed();
  }
};
stream.writer.writeSync(new Uint8Array(CHUNK));
await immediate();
await sleep(2);
const da = send();
await new Promise(resolve => (onChunk = () => chunks >= 3 && resolve(), onChunk()));
const db = send();
await new Promise(resolve => (onDbPassed = resolve, relay.holdUp && resolve()));
relay.onClient = () => {};

// 3. wait for the RTO: it destroys Da and Db
log("STEP 3: waiting for the RTO ('lost' for Db)");
const st = await status(db);
log("status of Db:", st, "Da:", statuses[da]);
await immediate();

// 4. the datagram that uses the second post-RTO slot is lost on the way
let slot2 = 0;
if (process.env.SLOT2 !== "0") {
  relay.loseDatagrams = 1;
  slot2 = send();
  await sleep(30);
  log("STEP 4: slot-2 datagram id", slot2, "sent and lost by the relay; loseDatagrams left:", relay.loseDatagrams);
} else {
  await sleep(30);
  log("STEP 4 skipped: the app sends nothing here, no datagram is lost");
}

// 5. the delayed ACKs arrive, in order. What the client sent after Db during the spike is lost.
log("STEP 5: release", relay.heldDown.length, "held downlink packets; drop", relay.heldUp.length, "held uplink packets");
relay.heldUp.length = 0;
relay.holdUp = false;
relay.holdDown = false;
for (const packet of relay.heldDown.splice(0)) front.send(packet, clientPort, "127.0.0.1");

// 6. healthy path from here on
const framedBefore = String(client.stats.datagramsSent);
let first;
if (COINCIDE) {
  // The event loop is busy across the moment the next MTU probe is due, and the app sends a datagram right after:
  // the tick that rings the probe alarm also frames the datagram.
  const due = relay.lastBigAt + 1000;
  log("probe due at", due, "now", now());
  await sleep(Math.max(0, due - 80 - now()));
  const busyFrom = now();
  while (now() < due + 200);
  first = send();
  log("STEP 6: event loop was busy from", busyFrom, "to", now(), "; datagram", first, "sent right after");
  await sleep(300);
  log("framed by lsquic before/after:", framedBefore, String(client.stats.datagramsSent));
} else {
  await sleep(PAUSE_MS);
  if (process.env.HEAD === "stream") {
    // The first thing the app does after the interruption is a stream write, in a tick of its own.
    stream.writer.writeSync(new Uint8Array(100));
    await sleep(20);
    log("STEP 6: the app wrote 100 bytes to its stream first");
  }
  first = nextId + 1;
}
log("STEP 6: path is healthy; the app resumes, one datagram every 50 ms");
const until = now() + OBSERVE_MS;
while (now() < until && !clientClosedAt) {
  send();
  await sleep(50);
}
const last = nextId;
const arrived = [];
for (let id = first; id <= last; id++) if (received.has(id)) arrived.push(id);
const firstArrival = arrived.length ? received.get(arrived[0]) - sentAt[first] : null;
const st6 = {};
for (let id = first; id <= last; id++) st6[statuses[id] ?? "none"] = (st6[statuses[id] ?? "none"] ?? 0) + 1;
console.log(
  "RESULT " +
    JSON.stringify({
      PROBES,
      IDLE,
      step6_sent: last - first + 1,
      step6_arrived: arrived.length,
      first_arrival_ms_after_resume: firstArrival,
      step6_statuses: st6,
      slot2_status: statuses[slot2] ?? "none",
      first_step6_id: first,
      first_step6_status: statuses[first] ?? "none",
      framedBefore,
      framedAtEnd: String(client.stats?.datagramsSent),
      clientClosedAt,
      resumedAt: sentAt[first],
      stats: {
        sent: String(client.stats?.datagramsSent),
        acked: String(client.stats?.datagramsAcknowledged),
        lost: String(client.stats?.datagramsLost),
      },
    }),
);
process.exit(0);
