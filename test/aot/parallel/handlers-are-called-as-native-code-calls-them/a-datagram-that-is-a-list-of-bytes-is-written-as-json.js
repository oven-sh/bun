// With binaryType the chunk is a Uint8Array.
Bun.udpSocket({
  hostname: "127.0.0.1",
  binaryType: "uint8array",
  socket: {
    data(socket, chunk, port, address, flags) {
      console.log(JSON.stringify(chunk), chunk instanceof Uint8Array, Buffer.isBuffer(chunk));
      socket.close();
    },
  },
}).then(socket => {
  socket.send("hi", socket.port, "127.0.0.1");
});
