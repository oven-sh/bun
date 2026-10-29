// Bun.serve with routes and a fetch handler answers two requests of the program itself and stops.
const server = Bun.serve({
  port: 0,
  routes: {
    "/health": new Response("ok"),
    "/users/:id": request => Response.json({ id: request.params.id }),
  },
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "POST") return Response.json({ echo: await request.json() });
    return new Response(`not found: ${url.pathname}`, { status: 404, headers: { "x-test": "1" } });
  },
});
const response = await fetch(new URL("/users/7", server.url));
console.log(response.status, await response.json());
const posted = await fetch(server.url, { method: "POST", body: JSON.stringify({ a: 1 }) });
console.log(await posted.json());
await server.stop();
