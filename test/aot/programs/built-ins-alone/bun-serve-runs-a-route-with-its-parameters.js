const server = Bun.serve({
  port: 0,
  routes: {
    "/items/:id": request => {
      console.log(typeof request.params, request.params.id.length, Object.keys(request.params).join());
      return new Response(request.params.id);
    },
  },
});
console.log(await (await fetch(new URL("/items/abc", server.url))).text());
await server.stop(true);
