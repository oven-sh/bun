import { listen, connect } from "bun";

var counter = 0;
const msg = Buffer.from("Hello World!");

const handlers = {
  open(socket) {
    if (!socket.data?.isServer) {
      if (!socket.write(msg)) {
        socket.data = { pending: msg };
      }
    }
  },
  data(socket, buffer) {
    if (!socket.write(buffer)) {
      socket.data = { pending: buffer };
      return;
    }
    counter++;
  },
  drain(socket) {
    const pending = socket.data?.pending;
    if (!pending) return;
    if (socket.write(pending)) {
      socket.data = undefined;
      counter++;
      return;
    }
  },
};

setInterval(() => {
  console.log("Wrote", counter, "messages");
  counter = 0;
}, 1000);

const server = listen({
  socket: handlers,
  hostname: "localhost",
  port: 8080,
  data: {
    isServer: true,
  },
});
const connection = await connect({
  socket: handlers,
  hostname: "localhost",
  port: 8080,
});
