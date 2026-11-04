const server = Bun.serve({ port: 0, fetch() { return new Response("ok"); } });
const response = await fetch(server.url);
console.log(response.body);
server.stop(true);
