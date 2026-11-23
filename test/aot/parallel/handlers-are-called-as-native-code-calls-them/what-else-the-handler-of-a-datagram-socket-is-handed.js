// The socket, the port, the address and the flags.
Bun.udpSocket({
  hostname: "127.0.0.1",
  socket: {
    data(socket, chunk, port, address, flags) {
      console.log(`${this === socket} ${typeof port} ${address} ${JSON.stringify(flags)}`);
      socket.close();
    },
  },
}).then(socket => {
  socket.send("hi", socket.port, "127.0.0.1");
});
