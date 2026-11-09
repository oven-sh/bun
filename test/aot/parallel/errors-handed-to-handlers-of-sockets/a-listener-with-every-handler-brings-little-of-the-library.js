// All four handlers that are handed an error are there. What they are handed is an error, nothing, or what another handler threw: no object of a class that nobody knows.
// STATISTIC: ImageFunctionsEmitted <= 30
const seen = (socket, error) => {};
const listener = Bun.listen({
  hostname: "127.0.0.1",
  port: 0,
  socket: { data() {}, close: seen, error: seen, connectError: seen, handshake(socket, isAuthorized, error) {} },
});
console.log(typeof listener.port);
listener.stop(true);
