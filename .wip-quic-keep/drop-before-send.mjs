// A node:quic client behind a UDP relay. During an outage the client's retransmission timeout (RTO) fires.
// The outage ends, and the client sends three datagrams at once. No packet is lost after the outage.
// expected (Node keeps a datagram that it cannot send yet, and sends it later): the server receives 3 of 3. exit 0.
// actual on bun: lsquic frames all three, sends one, and drops the other two before the send. exit 1.
import { createPrivateKey } from "node:crypto";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { connect, listen } from "node:quic";
const keys = "/workspace/bun/test/js/node/test/fixtures/keys/";
const key = createPrivateKey(readFileSync(keys + "agent1-key.pem"));
const cert = readFileSync(keys + "agent1-cert.pem");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const received = [];
const server = await listen(
  session => {
    session.onerror = () => {};
    session.closed.catch(() => {});
    session.onstream = stream => void stream.closed.catch(() => {});
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
const front = createSocket("udp4");
const up = createSocket("udp4");
let clientPort = 0;
let outage = false;
up.on("message", packet => void (outage || front.send(packet, clientPort, "127.0.0.1")));
front.on("message", (packet, from) => {
  clientPort = from.port;
  if (!outage) up.send(packet, server.address.port, "127.0.0.1");
});
front.bind(0, "127.0.0.1");
up.bind(0, "127.0.0.1");
await Promise.all([once(front, "listening"), once(up, "listening")]);

const statuses = {};
let onStatus = () => {};
const client = await connect(
  { address: "127.0.0.1", port: front.address().port },
  {
    alpn: "dbs",
    servername: "localhost",
    verifyPeer: "manual",
    transportParams: { maxIdleTimeout: 30 },
    onerror() {},
    ondatagramstatus(id, status) {
      statuses[id] = status;
      onStatus();
    },
  },
);
client.closed.catch(() => {});
await client.opened;
for (let i = 1; i <= 8; i++) {
  await client.sendDatagram(Buffer.alloc(700, i));
  await sleep(30);
}

// The outage: datagram 9 is lost, and stream data keeps the retransmission timer running.
outage = true;
await client.sendDatagram(Buffer.alloc(700, 9));
const stream = await client.createBidirectionalStream();
stream.closed.catch(() => {});
stream.writer.writeSync(new Uint8Array(64));
// Without an ACK, only the RTO can declare datagram 9 lost.
await new Promise(resolve => (onStatus = () => statuses[9] && resolve()));
await new Promise(resolve => setImmediate(resolve));

outage = false;
for (let i = 10; i <= 12; i++) client.sendDatagram(Buffer.alloc(700, i));
await sleep(1500);
const { datagramsSent: sent, datagramsAcknowledged: acknowledged, datagramsLost: lost } = client.stats;
console.log(JSON.stringify({ received, statuses, stats: `${sent}/${acknowledged}/${lost}` }));
process.exit([10, 11, 12].every(id => received.includes(id)) ? 0 : 1);
