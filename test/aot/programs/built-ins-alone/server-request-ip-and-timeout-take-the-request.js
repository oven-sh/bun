const server = Bun.serve({
  port: 0,
  fetch(request) {
    const address = server.requestIP(request);
    console.log(typeof address.address, typeof address.port, typeof address.family, server.timeout(request, 5) === undefined);
    return new Response("ok");
  },
});
await fetch(server.url);
await server.stop(true);
