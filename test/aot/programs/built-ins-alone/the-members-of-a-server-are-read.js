const server = Bun.serve({
  port: 0,
  fetch: () => new Response("ok"),
});
console.log(typeof server.port, typeof server.hostname, server.pendingRequests + 1, server.pendingWebSockets + 1, typeof server.development, typeof server.id, server.url instanceof URL);
await server.stop(true);
