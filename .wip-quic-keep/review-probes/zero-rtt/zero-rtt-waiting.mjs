// Review probe (scratch, not part of the repo). Same setup as the #44680 test
// "skips a datagram of a rejected 0-RTT flight without moving the ids after it",
// except that datagram 1 is LARGE so that its 0-RTT packet is a UDP datagram of its own.
// With LD_PRELOAD=/tmp/zrp/refuse.so NQ_REFUSE=0rtt the socket refuses that UDP datagram (EAGAIN),
// so the 0-RTT DATAGRAM packet is framed and waits in lsquic's scheduled queue when the server rejects early data.
import { createPrivateKey, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { connect, listen } from "node:quic";
const keys = "/workspace/bun/test/js/node/test/fixtures/keys/";
const key = createPrivateKey(readFileSync(keys + "agent1-key.pem"));
const cert = readFileSync(keys + "agent1-cert.pem");
const sni = { "*": { keys: [key], certs: [cert] } };
const tokenSecret = randomBytes(16);
const ticket = Promise.withResolvers();
const token = Promise.withResolvers();
const onSession = session => {
  session.onerror = () => {};
  session.closed.catch(() => {});
};
const SIZE = Number(process.env.SIZE ?? 1100);
const secondTp = process.env.SECOND_MAX_DG ? { maxDatagramFrameSize: Number(process.env.SECOND_MAX_DG) } : undefined;

const first = await listen(onSession, { sni, alpn: ["quic-test"], endpoint: { tokenSecret } });
const firstClient = await connect(first.address, {
  alpn: "quic-test",
  verifyPeer: "manual",
  onsessionticket: ticket.resolve,
  onnewtoken: token.resolve,
});
await Promise.all([firstClient.opened, ticket.promise, token.promise]);
await firstClient.close();
await first.close();

const received = [];
let onProgress = () => {};
const serverSession = Promise.withResolvers();
let serverClosed = null;
const second = await listen(
  session => {
    onSession(session);
    session.closed.then(
      () => (serverClosed = "resolved"),
      e => (serverClosed = String(e?.message ?? e)),
    );
    serverSession.resolve(session);
  },
  {
    sni,
    alpn: ["quic-test"],
    endpoint: { tokenSecret },
    enableEarlyData: false,
    ...(secondTp ? { transportParams: secondTp } : {}),
    ondatagram(datagram) {
      received.push(datagram[0]);
      onProgress();
    },
  },
);
const statuses = {};
let clientError = null;
const client = await connect(second.address, {
  alpn: "quic-test",
  verifyPeer: "manual",
  sessionTicket: await ticket.promise,
  token: await token.promise,
  onerror(e) {
    clientError = String(e?.message ?? e);
  },
  onearlyrejected() {},
  ondatagramstatus(id, status) {
    (statuses[Number(id)] ??= []).push(status);
    onProgress();
  },
});
let clientClosed = null;
client.closed.then(
  () => (clientClosed = "resolved"),
  e => (clientClosed = String(e?.message ?? e)),
);
console.error("PROBE-MARK second-client-start");
const ids = [await client.sendDatagram(Buffer.alloc(SIZE, 1))];
const { earlyDataAttempted, earlyDataAccepted } = await client.opened;
console.error("PROBE-MARK opened");
for (let i = 2; i <= 4; i++) ids.push(await client.sendDatagram(new Uint8Array([i])));
const deadline = Date.now() + Number(process.env.WAIT_MS ?? 4000);
await new Promise(resolve => {
  const done = () =>
    (Object.keys(statuses).length >= 4 && received.length >= 4) || Date.now() > deadline || clientClosed !== null;
  onProgress = () => done() && resolve();
  const timer = setInterval(() => done() && (clearInterval(timer), resolve()), 50);
  onProgress();
});
const { datagramsSent, datagramsAcknowledged, datagramsLost } = client.stats;
console.log(
  JSON.stringify({
    earlyDataAttempted,
    earlyDataAccepted,
    ids: ids.map(Number),
    received: received.toSorted((a, b) => a - b),
    statuses,
    stats: { sent: String(datagramsSent), acked: String(datagramsAcknowledged), lost: String(datagramsLost) },
    clientError,
    clientClosed,
    serverClosed,
  }),
);
try { client.destroy(); } catch {}
try { (await serverSession.promise).destroy(); } catch {}
process.exit(0);
