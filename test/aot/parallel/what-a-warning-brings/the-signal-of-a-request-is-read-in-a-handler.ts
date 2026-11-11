// Where there is a signal native code may warn (a listener that is null). The printer of warnings is compiled for that, and the queue of ticks that brings the warning to it. Nothing else of the library is.
// STATISTIC: ImageFunctionsEmitted <= 60
const server = Bun.serve({
  port: 0,
  fetch(request) {
    return new Response(String(typeof request.signal));
  },
});
server.stop();
console.log("stopped");
