// An app that resends each datagram that is reported 'lost', and sends its own datagram each 10 ms.
// A 3 s outage. Counts the 'lost' callbacks and the datagram packets that the relay sees.
import { createPrivateKey } from "node:crypto";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { connect, listen } from "node:quic";
const keys = "/workspace/bun/test/js/node/test/fixtures/keys/";
const key = createPrivateKey(readFileSync(keys + "agent1-key.pem"));
const cert = readFileSync(keys + "agent1-cert.pem");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const OUTAGE_MS = Number(process.env.OUTAGE_MS ?? 3000);

let received = 0;
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
    ondatagram() {
      received++;
    },
  },
);
const front = createSocket("udp4");
const up = createSocket("udp4");
let clientPort = 0;
let outage = false;
let datagramPackets = 0;
let datagramPacketsInOutage = 0;
up.on("message", packet => void (outage || front.send(packet, clientPort, "127.0.0.1")));
front.on("message", (packet, from) => {
  clientPort = from.port;
  if (!(packet[0] & 0x80) && packet.length >= 700) {
    datagramPackets++;
    if (outage) datagramPacketsInOutage++;
  }
  if (!outage) up.send(packet, server.address.port, "127.0.0.1");
});
front.bind(0, "127.0.0.1");
up.bind(0, "127.0.0.1");
await Promise.all([once(front, "listening"), once(up, "listening")]);

const counts = { acknowledged: 0, lost: 0, abandoned: 0 };
let lostInOutage = 0;
let client;
client = await connect(
  { address: "127.0.0.1", port: front.address().port },
  {
    alpn: "dbs",
    servername: "localhost",
    verifyPeer: "manual",
    transportParams: { maxIdleTimeout: 30 },
    onerror() {},
    ondatagramstatus(_id, status) {
      counts[status]++;
      if (status === "lost") {
        if (outage) lostInOutage++;
        client.sendDatagram(Buffer.alloc(700, 2));
      }
    },
  },
);
client.closed.catch(() => {});
await client.opened;
const stream = await client.createBidirectionalStream();
stream.closed.catch(() => {});
const timer = setInterval(() => void client.sendDatagram(Buffer.alloc(700, 1)), 10);
await sleep(1000);
outage = true;
stream.writer.writeSync(new Uint8Array(64));
await sleep(OUTAGE_MS);
outage = false;
await sleep(1500);
clearInterval(timer);
const { datagramsSent: sent, datagramsAcknowledged: acknowledged, datagramsLost: lost } = client.stats;
console.log(
  JSON.stringify({ lostInOutage, counts, received, datagramPackets, datagramPacketsInOutage, stats: `${sent}/${acknowledged}/${lost}` }),
);
process.exit(0);
