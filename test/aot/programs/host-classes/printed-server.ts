// console.log finds a method of the host under Symbol.for("nodejs.util.inspect.custom") and hands it util.inspect, which has to be in the executable: a server.
const server = Bun.serve({ port: 0, fetch: () => new Response("a") });
console.log(typeof Bun.inspect(server), Bun.inspect(server).split("\n")[0]);
server.stop(true);
