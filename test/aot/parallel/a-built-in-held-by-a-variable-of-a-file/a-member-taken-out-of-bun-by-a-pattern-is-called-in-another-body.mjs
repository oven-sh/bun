// The pattern's test for undefined and null stands between Bun and the read: the constant holds Bun.serve all the same.
// STATISTIC: ImageFunctionsEmitted <= 420
const { serve } = Bun;
function start() {
  return serve({
    port: 0,
    fetch() {
      return new Response("1");
    },
  });
}
const server = start();
console.log(typeof server.port);
server.stop(true);
