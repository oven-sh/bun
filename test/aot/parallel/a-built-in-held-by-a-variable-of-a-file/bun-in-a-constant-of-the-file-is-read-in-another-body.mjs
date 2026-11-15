// The constant is Bun in start() too: one member of it is read there and called.
// STATISTIC: ImageFunctionsEmitted <= 420
const bun = Bun;
function start() {
  return bun.serve({
    port: 0,
    fetch() {
      return new Response("1");
    },
  });
}
const server = start();
console.log(typeof server.port);
server.stop(true);
