// node:dgram: two sockets on 127.0.0.1 send each other messages; bind, address, the fields of rinfo, several buffers in one send, connect and disconnect, close, and what is thrown after it.
import dgram from "node:dgram";
import { once } from "node:events";

const server = dgram.createSocket("udp4");
server.bind(0, "127.0.0.1");
await once(server, "listening");
const { address, family, port } = server.address();
console.log(address, family, port > 0);

const client = dgram.createSocket({ type: "udp4" });
server.on("message", (message, rinfo) => server.send("echo " + message, rinfo.port, rinfo.address));
client.send("one", port, "127.0.0.1");
const [first, rinfo] = await once(client, "message");
console.log(first.toString(), rinfo.address, rinfo.family, rinfo.port === port, rinfo.size);
console.log(await new Promise(resolve => client.send([Buffer.from("two "), "parts"], port, "127.0.0.1", (error, bytes) => resolve([error, bytes].join()))));
console.log((await once(client, "message"))[0].toString());

client.connect(port, "127.0.0.1");
await once(client, "connect");
console.log(client.remoteAddress().port === port);
client.send("connected");
console.log((await once(client, "message"))[0].toString());
client.disconnect();
try {
  client.remoteAddress();
} catch (error) {
  console.log(error.code);
}
client.close();
await once(client, "close");
try {
  client.send("late", port);
} catch (error) {
  console.log(error.code);
}
await new Promise(resolve => server.close(resolve));
console.log(typeof dgram.Socket, server instanceof dgram.Socket);
