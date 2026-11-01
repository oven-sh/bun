// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
const server = Bun.serve({ port: 0, fetch() { return new Response("ok"); } });
console.log(String(Bun.inspect(server.url)).split("\n")[0]);
server.stop(true);
