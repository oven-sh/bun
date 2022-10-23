import { createRequire } from "node:module";
const net = createRequire(import.meta.url)("net");

const buffer = Buffer.from("Hello World!");
var counter = 0;
const handlers = {
  open() {
    if (!socket.data?.isServer) {
      if (!this.write(buffer)) {
        socket.data = { pending: buffer };
      }
    }
  },
  data(buffer) {
    if (!this.write(buffer)) {
      this.data = { pending: buffer.slice() };
      return;
    }
    counter++;
  },
  drain() {
    const pending = this.data?.pending;
    if (!pending) return;
    if (this.write(pending)) {
      this.data = undefined;
      counter++;
      return;
    }
  },
};

const server = net.createServer(function (socket) {
  socket.data = { isServer: true };
  socket.on("connection", handlers.open.bind(socket));
  socket.on("data", handlers.data.bind(socket));
  socket.on("drain", handlers.drain.bind(socket));
  socket.setEncoding("binary");
});

setInterval(() => {
  console.log("Wrote", counter, "messages");
  counter = 0;
}, 1000);

server.listen(8000);

const socket = net.connect({ host: "localhost", port: 8000 }, () => {});
socket.on("connection", handlers.open.bind(socket));
socket.on("data", handlers.data.bind(socket));
socket.on("drain", handlers.drain.bind(socket));
socket.setEncoding("binary");
socket.write(buffer);
