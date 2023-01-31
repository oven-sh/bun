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

if (process.env.IS_SERVER) {
  if (net.createServer) {
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
  } else {
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

    const server = Bun.listen({
      socket: handlers,
      hostname: "0.0.0.0",
      port: 8000,
      data: {
        isServer: true,
      },
    });
  }
} else {
  const socket = net.connect({ host: "0.0.0.0", port: 8000 }, () => {});
  socket.on("connection", handlers.open.bind(socket));
  socket.on("data", handlers.data.bind(socket));
  socket.on("drain", handlers.drain.bind(socket));
  socket.setEncoding("binary");
  socket.write(buffer);
}
