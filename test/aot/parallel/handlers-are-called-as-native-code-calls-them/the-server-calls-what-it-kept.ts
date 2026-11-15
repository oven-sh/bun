const log: unknown[] = [];
const server = Bun.serve({ port: 0, fetch(request, second) { log.push(request.constructor.name, typeof second, this === server, new URL(request.url).pathname); return new Response("a"); } });
await server.fetch("http://localhost/x");
await server.fetch(new Request("http://localhost/y"));
await fetch(new URL("/z", server.url));
await server.stop(true);
console.log(log.join());
