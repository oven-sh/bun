import { connect, listen } from "bun";

var counter = 0;
const msg = "Hello World!";

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

if (process.env.IS_SERVER)
  listen({
    socket: handlers,
    hostname: "0.0.0.0",
    port: 8000,
    data: {
      isServer: true,
    },
  });
else
  await connect({
    socket: handlers,
    hostname: "localhost",
    port: 8000,
  });
