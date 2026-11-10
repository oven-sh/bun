// Receive side of UDP over loopback. Each iteration queues a burst of datagrams on a bound
// socket, then waits until the receiver has got all of them.
import dgram from "node:dgram";
import { bench, group, run } from "../runner.mjs";

const bursts = [1, 8, 64];
const sizes = [64, 1400];

async function nodeDgram() {
  const receiver = dgram.createSocket("udp4");
  const sender = dgram.createSocket("udp4");
  await new Promise(resolve => receiver.bind(0, "127.0.0.1", resolve));
  await new Promise(resolve => sender.connect(receiver.address().port, "127.0.0.1", resolve));
  let left = 0;
  let done;
  receiver.on("message", () => {
    if (--left === 0) done();
  });
  return {
    burst(count, payload) {
      return new Promise(resolve => {
        left = count;
        done = resolve;
        for (let i = 0; i < count; i++) sender.send(payload);
      });
    },
    close() {
      receiver.close();
      sender.close();
    },
  };
}

async function bunUdpSocket() {
  let left = 0;
  let done;
  const receiver = await Bun.udpSocket({
    hostname: "127.0.0.1",
    socket: {
      data() {
        if (--left === 0) done();
      },
    },
  });
  const sender = await Bun.udpSocket({ connect: { hostname: "127.0.0.1", port: receiver.port } });
  return {
    burst(count, payload) {
      return new Promise(resolve => {
        left = count;
        done = resolve;
        for (let i = 0; i < count; i++) sender.send(payload);
      });
    },
    close() {
      receiver.close();
      sender.close();
    },
  };
}

const apis = { "node:dgram": await nodeDgram() };
if (typeof Bun !== "undefined") apis["Bun.udpSocket"] = await bunUdpSocket();

for (const [name, api] of Object.entries(apis)) {
  group(name, () => {
    for (const size of sizes) {
      const payload = Buffer.alloc(size, "a");
      for (const count of bursts) {
        bench(`${count} x ${size} B`, () => api.burst(count, payload));
      }
    }
  });
}

await run();

for (const api of Object.values(apis)) api.close();
