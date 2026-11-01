// Alone: what it prints depends on what else the executable holds: whether the printer of node:util was compiled in
const server = Bun.serve({ port: 0, fetch(request) { console.log(request.body); return new Response("ok"); } });
console.log(await (await fetch(server.url, { method: "POST", body: "x" })).text());
server.stop(true);
