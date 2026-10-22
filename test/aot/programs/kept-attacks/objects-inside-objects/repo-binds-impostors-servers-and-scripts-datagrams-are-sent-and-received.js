// Objects inside objects: repo binds impostors servers and scripts datagrams are sent and received. It prints what plain Bun prints.
import dgram from "node:dgram";

const receiver = dgram.createSocket("udp4");
const got = [];
receiver.on("message", (message, info) => {
  got.push(message.toString() + " from " + info.address + " " + info.family + " " + info.size);
  if (got.length === 2) receiver.close();
});
await new Promise(resolve => receiver.bind(0, "127.0.0.1", resolve));
const { port, address, family } = receiver.address();
console.log(typeof port, address, family);
const sender = dgram.createSocket({ type: "udp4" });
await new Promise(resolve => sender.send("first", port, "127.0.0.1", resolve));
await new Promise(resolve => sender.send([Buffer.from("sec"), "ond"], port, "127.0.0.1", (error, bytes) => resolve(console.log(error, bytes))));
await new Promise(resolve => receiver.on("close", resolve));
sender.close();
console.log(got);
try {
  sender.send("late", port);
} catch (error) {
  console.log(error.code);
}

const heard = Promise.withResolvers();
const bunReceiver = await Bun.udpSocket({ hostname: "127.0.0.1", socket: { data: (socket, data, fromPort, fromAddress) => heard.resolve(data.toString() + " " + fromAddress + " " + (fromPort > 0)) } });
const bunSender = await Bun.udpSocket({ hostname: "127.0.0.1" });
console.log(bunSender.send("through bun", bunReceiver.port, "127.0.0.1"), await heard.promise, bunReceiver.hostname, bunReceiver.closed);
bunReceiver.close();
bunSender.close();
console.log(bunReceiver.closed);
