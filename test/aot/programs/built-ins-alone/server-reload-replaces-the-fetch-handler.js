const server = Bun.serve({
  port: 0,
  fetch: () => new Response("old"),
});
server.reload({
  fetch() {
    return new Response("new");
  },
});
console.log(await (await fetch(server.url)).text());
await server.stop(true);
