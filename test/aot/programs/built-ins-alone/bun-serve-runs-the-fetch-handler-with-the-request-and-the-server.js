const server = Bun.serve({
  port: 0,
  fetch(request, passed) {
    console.log(request instanceof Request, request.method, new URL(request.url).pathname, passed === server, this === server, arguments.length);
    return new Response("answer");
  },
});
const response = await fetch(new URL("/path", server.url));
console.log(response.status + 1, (await response.text()).length);
await server.stop(true);
