const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  routes: {
    "/health": new Response("ok"),
    "/users/:id": request => Response.json({ id: request.params.id, verbose: new URL(request.url).searchParams.has("verbose") }),
    "/items": {
      GET: () => Response.json(["one", "two"]),
      POST: async request => Response.json({ received: await request.text() }, { status: 201 }),
    },
    "/files/*": request => new Response("file " + new URL(request.url).pathname.slice("/files/".length)),
    "/fails": () => {
      throw new TypeError("on purpose");
    },
  },
  fetch() {
    return new Response("fallback", { status: 404 });
  },
  error(error) {
    return new Response(error.name + ": " + error.message, { status: 500 });
  },
});

async function show(path, init) {
  const response = await fetch(new URL(path, server.url), init);
  console.log(path, response.status, await response.text());
}
await show("/health");
await show("/users/42?verbose");
await show("/users/a%20b");
await show("/items");
await show("/items", { method: "POST", body: "three" });
await show("/items", { method: "DELETE" });
await show("/files/a/b/c.txt");
await show("/fails");
await show("/unknown");
server.stop(true);
