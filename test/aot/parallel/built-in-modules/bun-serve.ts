const server = Bun.serve({
  port: 0,
  routes: { "/text": new Response("text"), "/users/:id": request => new Response(request.params.id) },
  fetch: async request => Response.json({ path: new URL(request.url).pathname, body: await request.text() }),
});
for (const path of ["text", "users/7", "other"]) console.log(await (await fetch(`${server.url}${path}`)).text());
await server.stop(true);
console.log("stopped");

export {};
