const server = Bun.serve({
  port: 0,
  development: true,
  fetch: () => new Response("ok"),
  websocket: { message() {} },
});
console.log(typeof server.address.port, typeof server.address.address, server.address.family, server.protocol, server.development);
console.log(server.ref() === undefined, server.unref() === undefined, server.closeIdleConnections() === undefined);
console.log(server.subscriberCount("news") + 1, server.publish("news", "text") + 1, typeof server.port, server.url.protocol, typeof server.id);
console.log(server.pendingRequests + 1, server.pendingWebSockets + 1, typeof server.hostname);
await server.stop(true);
