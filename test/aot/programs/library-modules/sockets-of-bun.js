// Bun.listen and Bun.connect, Bun.udpSocket and Bun.dns: a TCP echo with the handlers in an object, data attached to a socket, the close of both sides, a refused connection, datagrams on the loopback, and a look-up.
const events = [];
const server = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  data: { role: "server" },
  socket: {
    open(socket) { events.push("server open " + socket.data.role); },
    data(socket, bytes) { socket.write("echo " + bytes); socket.end(); },
    close() { events.push("server close"); },
  },
});
const received = await new Promise((resolve, reject) => {
  let text = "";
  Bun.connect({
    hostname: "127.0.0.1",
    port: server.port,
    data: { role: "client" },
    socket: {
      open(socket) { events.push("client open " + socket.data.role); socket.write("hello"); },
      data(socket, bytes) { text += bytes; },
      close() { events.push("client close"); resolve(text); },
      error(socket, error) { reject(error); },
    },
  }).catch(reject);
});
await Bun.sleep(5);
console.log(received, events.sort().join(", "), server.hostname, server.port > 0);
const port = server.port;
server.stop(true);
console.log(await Bun.connect({ hostname: "127.0.0.1", port, socket: { data() {}, open() {}, connectError() {} } }).then(() => "connected", error => error.code));

const heard = Promise.withResolvers();
const listener = await Bun.udpSocket({ hostname: "127.0.0.1", socket: { data(socket, bytes, fromPort, fromAddress) { heard.resolve(bytes.toString() + " from " + fromAddress + " " + (fromPort > 0)); } } });
const sender = await Bun.udpSocket({ hostname: "127.0.0.1" });
sender.send("datagram", listener.port, "127.0.0.1");
console.log(await heard.promise, listener.address.family, listener.closed);
listener.close();
sender.close();
console.log(listener.closed);
const found = await Bun.dns.lookup("localhost");
console.log(found.length > 0, found.every(entry => ["127.0.0.1", "::1"].includes(entry.address)), typeof Bun.dns.getCacheStats().size, typeof Bun.dns.prefetch);
