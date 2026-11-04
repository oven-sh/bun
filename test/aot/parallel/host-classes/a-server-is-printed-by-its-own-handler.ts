// The host hands the server to the handler, which prints it.
const server = Bun.serve({
  port: 0,
  fetch: (request, server) => new Response(String(Bun.inspect(server).includes("url: URL {"))),
});
console.log(await (await fetch(server.url)).text());
server.stop(true);

export {};
