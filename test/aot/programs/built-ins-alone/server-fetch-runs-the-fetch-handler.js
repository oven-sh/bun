const server = Bun.serve({
  port: 0,
  fetch(request) {
    return new Response(new URL(request.url).pathname);
  },
});
console.log(await (await server.fetch(new Request(new URL("/inner", server.url)))).text());
await server.stop(true);
