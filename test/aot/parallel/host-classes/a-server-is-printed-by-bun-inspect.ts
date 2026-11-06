// Bun.inspect asks a server for its `url`, finds a method of the host under Symbol.for("nodejs.util.inspect.custom") on the answer and hands it util.inspect, which has to be in the executable.
// Alone: what an executable leaves out goes by all that it holds
const server = Bun.serve({ port: 0, fetch: () => new Response("a") });
console.log(typeof Bun.inspect(server), Bun.inspect(server).split("\n")[0]);
console.log(Bun.inspect({ server }).includes("url: URL {"), Bun.inspect.table([{ server }]).length > 0);
server.stop(true);

export {};
