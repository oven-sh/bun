// An accepted socket begins with the data of its listener: the program reads it, calls its method and stores another. The connection comes from a shell, without a promise.
// STATISTIC: ImageFunctionsEmitted <= 30
const held = {
  count: 2,
  twice() {
    return this.count * 2;
  },
};
const listener = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  data: held,
  socket: {
    open(socket) {
      console.log(socket.data === held, socket.data.twice());
      socket.data = { count: 5, twice: held.twice };
      console.log(socket.data.twice(), listener.data === held);
      socket.end();
    },
    data() {},
    close() {
      listener.stop(true);
    },
  },
});
Bun.spawnSync(["bash", "-c", `exec 3<>/dev/tcp/127.0.0.1/${listener.port}`]);
