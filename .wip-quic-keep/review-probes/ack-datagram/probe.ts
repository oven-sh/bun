// Review probe (not a test of the repo): what becomes of a DATAGRAM packet that
// also holds an ACK frame when the UDP socket refuses it. The harness is a copy
// of test/js/node/quic/quic-datagram.test.ts (relay + sessionThroughRelay).
//
// The LD_PRELOAD shim (shim2.so) refuses, with EAGAIN, every sendmmsg() to the
// port written in the file ACKDG_FLAG: the relay's client-facing port, so only
// the QUIC client is refused.
//
// MODE=bypass: after a retransmission timeout has used up sc_next_limit, build
//   [ACK+DG27, DG28, DG29] while the socket refuses, then let a delayed tick
//   that owes an ACK set PO_REPACKNO and let the socket accept in that pass.
// MODE=stale: no timeout. Build [ACK+DG, DG, DG] while the socket refuses,
//   hold HOLD_MS, accept again. What ACK does the server see?
import { createPrivateKey } from "node:crypto";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { readFileSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { connect, listen } from "node:quic";

const keysDir = "/workspace/bun/test/js/node/test/fixtures/keys/";
const key = createPrivateKey(readFileSync(keysDir + "agent1-key.pem"));
const cert = readFileSync(keysDir + "agent1-cert.pem");
const sni = { "*": { keys: [key], certs: [cert] } };

const FLAG = process.env.ACKDG_FLAG!;
const MODE = process.env.MODE ?? "bypass";
const BUSY_MS = Number(process.env.BUSY_MS ?? 30);
const GAP_MS = Number(process.env.GAP_MS ?? 10);
const OBSERVE_MS = Number(process.env.OBSERVE_MS ?? 60);
const HOLD_MS = Number(process.env.HOLD_MS ?? 300);
const BURST = Number(process.env.BURST ?? 3);
const Y_STEP = process.env.Y_STEP ?? "ack"; // "ack": a delayed tick that owes an ACK; "none": just accept again
// Both sides issue NEW_CONNECTION_ID frames for some seconds after the handshake. One that is lost at the
// timeout is resent, takes a packet that the timeout allows, and the next one waits at the gate: then every
// tick is a delayed one and no datagram is framed. The probe starts after that.
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 9000);

const LARGE = 1100;
const MEDIUM = 750;
const SMALL = 200;
const CHUNK = 300;
const lengthIn = (min: number, max: number) => (packet: Buffer) =>
  !(packet[0] & 0x80) && packet.length >= min && packet.length < max;
const carriesLarge = lengthIn(LARGE, 1400);
const carriesMedium = lengthIn(MEDIUM, LARGE);
const carriesChunk = lengthIn(CHUNK, 3 * SMALL);
const WARM_UP = 24;

const t0 = performance.now();
const at = () => (performance.now() - t0).toFixed(1);
const mark = (text: string) => void writeSync(2, `@@MARK ${at()}ms ${text}\n`);
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const busy = (ms: number) => {
  const end = performance.now() + ms;
  while (performance.now() < end);
};
const check = (ok: boolean, what: string) => {
  if (!ok) throw new Error("probe precondition failed: " + what);
};

async function relayTo(serverPort: number) {
  const front = createSocket("udp4");
  const upstream = createSocket("udp4");
  let clientPort = 0;
  const forServer: Buffer[] = [];
  const forClient: Buffer[] = [];
  const relay = {
    port: 0,
    lose: (_packet: Buffer): boolean => false,
    outage: false,
    /** While true, the relay keeps the MEDIUM datagrams of the server and passes everything else. */
    holdForClient: false,
    keptMedium: () => forClient.filter(carriesMedium).length,
    keptForClient: () => forClient.length,
    deliverMedium(count: number) {
      let end = 0;
      for (let seen = 0; end < forClient.length && seen < count; end++) seen += +carriesMedium(forClient[end]);
      for (const packet of forClient.splice(0, end)) front.send(packet, clientPort, "127.0.0.1");
    },
    release() {
      relay.outage = false;
      relay.holdForClient = false;
      for (const packet of forServer.splice(0)) upstream.send(packet, serverPort, "127.0.0.1");
      for (const packet of forClient.splice(0)) front.send(packet, clientPort, "127.0.0.1");
    },
    onClientPacket: (_packet: Buffer) => {},
    onServerPacket: () => {},
    close() {
      front.close();
      upstream.close();
    },
  };
  upstream.on("message", packet => {
    if (relay.outage || (relay.holdForClient && carriesMedium(packet))) forClient.push(packet);
    else front.send(packet, clientPort, "127.0.0.1");
    relay.onServerPacket();
  });
  front.on("message", (packet, from) => {
    clientPort = from.port;
    relay.onClientPacket(packet);
    if (relay.lose(packet)) return;
    if (relay.outage) forServer.push(packet);
    else upstream.send(packet, serverPort, "127.0.0.1");
  });
  front.bind(0, "127.0.0.1");
  upstream.bind(0, "127.0.0.1");
  await Promise.all([once(front, "listening"), once(upstream, "listening")]);
  relay.port = front.address().port;
  return relay;
}

async function sessionThroughRelay(maxIdleTimeout = 10) {
  const received: number[] = [];
  const receivedAt: Record<number, string> = {};
  let onReceived = () => {};
  const serverSession = Promise.withResolvers<any>();
  const serverSessionClosed = Promise.withResolvers<void>();
  const server = await listen(
    session => {
      serverSession.resolve(session);
      session.onerror = () => {};
      session.closed.then(serverSessionClosed.resolve, serverSessionClosed.resolve);
      session.onstream = async (stream: any) => {
        stream.closed.catch(() => {});
        try {
          for await (const batch of stream) for (const chunk of [batch].flat()) stream.writer.writeSync(chunk);
        } catch {}
      };
    },
    {
      sni,
      alpn: ["quic-test"],
      transportParams: { maxIdleTimeout },
      ondatagram(datagram: Uint8Array) {
        received.push(datagram[0]);
        receivedAt[datagram[0]] = at();
        onReceived();
      },
    },
  );
  const relay = await relayTo(server.address.port);

  const statuses = new Map<number, string[]>();
  let onStatus = () => {};
  let fromServer = 0;
  let onServerDatagram = () => {};
  let onServerStream = () => {};
  const client = await connect(
    { address: "127.0.0.1", port: relay.port },
    {
      alpn: "quic-test",
      servername: "localhost",
      verifyPeer: "manual",
      transportParams: { maxIdleTimeout },
      onerror() {},
      ondatagram() {
        fromServer++;
        onServerDatagram();
      },
      ondatagramstatus(id: bigint, status: string) {
        statuses.set(Number(id), [...(statuses.get(Number(id)) ?? []), status]);
        onStatus();
      },
      async onstream(stream: any) {
        stream.closed.catch(() => {});
        try {
          for await (const _ of stream);
        } catch {}
        onServerStream();
      },
    },
  );
  await client.opened;

  const ids: Promise<bigint>[] = [];
  const until = (done: () => boolean, listen: (check: () => void) => void) =>
    new Promise<void>(resolve => {
      const check = () => done() && resolve();
      listen(check);
      check();
    });
  const send = (size = LARGE) => {
    ids.push(client.sendDatagram(Buffer.alloc(size, ids.length + 1)));
    return ids.length;
  };
  const status = (id: number) =>
    until(
      () => statuses.has(id),
      check => (onStatus = check),
    ).then(() => statuses.get(id)![0]);
  return {
    client,
    relay,
    send,
    status,
    sent: () => ids.length,
    received: () => received.toSorted((a, b) => a - b),
    receivedAt: () => receivedAt,
    statuses: () => Object.fromEntries(statuses),
    untilReceived: (id: number) =>
      until(
        () => received.includes(id),
        check => (onReceived = check),
      ),
    async warmUp() {
      for (let i = 0; i < WARM_UP; i += 2) {
        send();
        check((await status(send())) === "acknowledged", "warm-up datagram acknowledged");
      }
    },
    async settled() {
      const last = ids.length;
      await until(
        () => received.includes(last),
        check => (onReceived = check),
      );
      const read = new Promise<void>(resolve => (onServerStream = resolve));
      const stream = await (await serverSession.promise).createUnidirectionalStream({ body: new Uint8Array(1) });
      stream.closed.catch(() => {});
      await read;
      await new Promise<void>(resolve => setImmediate(resolve));
    },
    async echoStream() {
      const stream = await client.createBidirectionalStream();
      stream.closed.catch(() => {});
      let count = 0;
      let onEcho = () => {};
      (async () => {
        try {
          for await (const batch of stream) {
            for (const chunk of [batch].flat()) count += chunk.byteLength;
            onEcho();
          }
        } catch {}
      })();
      return {
        write: (size: number) => void stream.writer.writeSync(new Uint8Array(size)),
        echoed: (size: number) =>
          until(
            () => count >= size,
            check => (onEcho = check),
          ),
      };
    },
    async serverDatagrams(count: number) {
      const session = await serverSession.promise;
      const want = relay.keptMedium() + count;
      for (let i = 0; i < count; i++) session.sendDatagram(new Uint8Array(MEDIUM));
      await until(
        () => relay.keptMedium() >= want,
        check => (relay.onServerPacket = check),
      );
    },
    /** The relay hands the client the next `n` datagrams of the server. Resolves inside the dispatch of the last one. */
    async deliver(n: number, inDispatch = () => {}) {
      const last = fromServer + n;
      const dispatched = until(
        () => fromServer >= last,
        check =>
          (onServerDatagram = () => {
            if (fromServer === last) inDispatch();
            check();
          }),
      );
      relay.deliverMedium(n);
      await dispatched;
    },
    async timeout(echo: { write(size: number): void }) {
      relay.lose = carriesLarge;
      relay.outage = true;
      const inOutage = send();
      await new Promise<void>(resolve => (relay.onClientPacket = () => resolve()));
      echo.write(64);
      check((await status(inOutage)) === "lost", "the datagram of the timeout is lost");
      await new Promise<void>(resolve => setImmediate(resolve));
    },
    async close() {
      relay.lose = () => false;
      relay.release();
      client.close();
      await Promise.all([client.closed.catch(() => {}), serverSessionClosed.promise]);
      relay.close();
      await server[Symbol.asyncDispose]();
    },
  };
}

const refuse = (port: number) => writeFileSync(FLAG, String(port));
const accept = () => {
  try {
    unlinkSync(FLAG);
  } catch {}
};
accept();

const kindOf = (p: Buffer) =>
  p[0] & 0x80
    ? `long(${p.length})`
    : carriesLarge(p)
      ? `LARGE(${p.length})`
      : carriesMedium(p)
        ? `MEDIUM(${p.length})`
        : carriesChunk(p)
          ? `CHUNK(${p.length})`
          : `short(${p.length})`;

const watchdog = setTimeout(() => {
  mark("WATCHDOG: probe did not finish");
  accept();
  process.exit(3);
}, 90000);

const net = await sessionThroughRelay(60);
const { relay, client } = net;
const seen: string[] = [];
let result: Record<string, unknown> = {};
try {
  if (MODE === "bypass") {
    const echo = await net.echoStream();
    await net.warmUp();
    await sleep(SETTLE_MS);
    relay.outage = true;
    await net.serverDatagrams(6);
    mark("timeout(): outage, datagram 25 is lost, stream data waits for the RTO");
    await net.timeout(echo);
    relay.lose = () => false;
    relay.onClientPacket = p => {
      seen.push(`${at()}ms ${kindOf(p)}`);
      mark(`relay got client packet ${kindOf(p)}`);
    };
    mark("RTO fired. send 26: it uses the last packet that the RTO allows");
    net.send();
    await sleep(15);
    const left26 = seen.some(line => line.includes("LARGE"));
    mark(`datagram 26 ${left26 ? "left" : "did NOT leave (it waits at the gate: the scenario is not formed)"}`);

    mark("X: deliver one server datagram to the client");
    await net.deliver(1, () => {
      busy(BUSY_MS);
      refuse(relay.port);
      mark(`X: in dispatch, socket refuses from now; send ${BURST} LARGE datagrams (27..)`);
      for (let i = 0; i < BURST; i++) net.send();
    });
    mark("X: dispatch returned");
    await sleep(GAP_MS);

    if (Y_STEP === "ack") {
      mark("Y: deliver one more server datagram to the client");
      await net.deliver(1, () => {
        busy(BUSY_MS);
        accept();
        mark("Y: in dispatch, socket accepts again; a SMALL datagram write forces a tick");
        net.send(SMALL);
      });
      mark("Y: dispatch returned");
    } else if (Y_STEP === "ack-refused") {
      // The delayed tick that owes an ACK runs while the socket still refuses: the send attempt of that pass
      // fails after lsquic_send_ctl_next_packet_to_send() has renumbered and cut the packet.
      mark("Y: deliver one more server datagram to the client (socket still refuses)");
      await net.deliver(1, () => {
        busy(BUSY_MS);
        mark("Y: in dispatch, socket STILL refuses; a SMALL datagram write forces a tick");
        net.send(SMALL);
      });
      mark("Y: dispatch returned");
      await sleep(GAP_MS);
      mark("Y: socket accepts again");
      accept();
    } else {
      mark("Y: socket accepts again (no new ACK owed)");
      accept();
    }
    const n0 = seen.length;
    await sleep(OBSERVE_MS);
    const leftWhileGateClosed = seen.slice(n0);
    const seenInX = seen.slice(0, n0);
    mark("observe window over; end of outage");
    relay.onClientPacket = () => {};
    relay.release();
    await echo.echoed(64);
    for (let i = 0; i < 6; i++) net.send(MEDIUM);
    await net.settled();
    const { datagramsSent: sent, datagramsAcknowledged: acknowledged, datagramsLost: lost } = client.stats;
    result = {
      mode: MODE,
      yStep: Y_STEP,
      left26,
      seenBeforeY: seenInX,
      leftWhileGateClosed,
      received: net.received(),
      statuses: net.statuses(),
      stats: `${sent}/${acknowledged}/${lost}`,
    };
  } else if (MODE === "stale") {
    await net.warmUp();
    await sleep(SETTLE_MS);
    relay.holdForClient = true;
    await net.serverDatagrams(2);
    relay.onClientPacket = p => {
      seen.push(`${at()}ms ${kindOf(p)}`);
      mark(`relay got client packet ${kindOf(p)}`);
    };
    const first = net.sent() + 1;
    mark("X: deliver one server datagram to the client");
    await net.deliver(1, () => {
      busy(BUSY_MS);
      refuse(relay.port);
      mark(`X: in dispatch, socket refuses from now; send ${BURST} LARGE datagrams (${first}..)`);
      for (let i = 0; i < BURST; i++) net.send();
    });
    mark("X: dispatch returned");
    await sleep(HOLD_MS / 2);
    mark("a SMALL datagram write during the hold: one tick, no ACK owed");
    net.send(SMALL);
    await sleep(HOLD_MS / 2);
    mark("socket accepts again");
    accept();
    await net.untilReceived(first + BURST - 1);
    mark("the burst reached the server");
    relay.release();
    for (let i = 0; i < 4; i++) net.send(MEDIUM);
    await net.settled();
    const { datagramsSent: sent, datagramsAcknowledged: acknowledged, datagramsLost: lost } = client.stats;
    result = {
      mode: MODE,
      holdMs: HOLD_MS,
      firstOfBurst: first,
      seen,
      received: net.received(),
      receivedAt: net.receivedAt(),
      statuses: net.statuses(),
      stats: `${sent}/${acknowledged}/${lost}`,
    };
  } else {
    throw new Error("unknown MODE");
  }
} finally {
  accept();
}
console.log(JSON.stringify(result));
mark("result printed");
clearTimeout(watchdog);
await net.close();
process.exit(0);
