// The same inside a record.
Bun.udpSocket({
  hostname: "127.0.0.1",
  socket: {
    data(socket, chunk, port, address, flags) {
      console.log(JSON.stringify({ chunk }));
      socket.close();
    },
  },
}).then(socket => {
  socket.send("hi", socket.port, "127.0.0.1");
});
