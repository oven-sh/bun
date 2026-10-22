const server = Bun.serve({
  port: 0,
  routes: {
    "/item": {
      GET: () => new Response("got"),
      POST: async request => new Response(`posted ${(await request.text()).length}`),
    },
  },
});
console.log(await (await fetch(new URL("/item", server.url))).text());
console.log(await (await fetch(new URL("/item", server.url), { method: "POST", body: "abc" })).text());
await server.stop(true);
