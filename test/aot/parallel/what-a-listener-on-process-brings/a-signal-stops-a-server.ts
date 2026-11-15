// The event is written and is one of those at which native code hands a listener no object of its own: nothing of the library comes with the listener.
// STATISTIC: ImageFunctionsEmitted <= 20
const server = Bun.serve({ port: 0, fetch: () => new Response("here") });
process.on("SIGINT", () => {
  server.stop();
});
server.stop();
console.log("stopped");
