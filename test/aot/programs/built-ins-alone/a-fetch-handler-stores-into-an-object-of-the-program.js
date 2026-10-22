const seen = { count: 0 };
const server = Bun.serve({
  port: 0,
  fetch(request) {
    seen.count = request.headers.get("x-name");
    return new Response("ok");
  },
});
await fetch(server.url, { headers: { "x-name": "text" } });
console.log(typeof seen.count, seen.count.length);
await server.stop(true);
