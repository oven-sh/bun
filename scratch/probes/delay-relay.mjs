// Scratch: a UDP relay that delays every datagram by DELAY ms in each direction.
// usage: delay-relay.mjs <server port> <delay ms>   (prints its own port, runs until killed)
import { createSocket } from "node:dgram";
const serverPort = Number(process.argv[2]);
const delay = Number(process.argv[3] ?? 15);
const front = createSocket("udp4");
const clients = new Map(); // client port -> upstream socket
front.on("message", (msg, from) => {
  let up = clients.get(from.port);
  if (!up) {
    up = createSocket("udp4");
    up.on("message", back => setTimeout(() => front.send(back, from.port, "127.0.0.1"), delay));
    clients.set(from.port, up);
  }
  const copy = Buffer.from(msg);
  setTimeout(() => up.send(copy, serverPort, "127.0.0.1"), delay);
});
front.bind(0, "127.0.0.1", () => console.log(front.address().port));
