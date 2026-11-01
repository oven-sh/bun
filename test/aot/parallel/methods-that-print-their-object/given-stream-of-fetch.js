// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
const server = Bun.serve({ port: 0, fetch() { return new Response("ok"); } });
const response = await fetch(server.url);
console.log(response.body);
server.stop(true);
