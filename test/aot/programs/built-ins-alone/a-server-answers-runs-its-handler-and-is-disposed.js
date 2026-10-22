const seen = { path: 0 };
const server = Bun.serve({
  port: 0,
  development: false,
  fetch(request, passed) {
    seen.path = new URL(request.url).pathname;
    console.log(passed === server, typeof passed.requestIP(request).address, passed.timeout(request, 5) === undefined, passed.upgrade(request));
    return new Response("old");
  },
  websocket: { message() {} },
});
console.log(await (await fetch(new URL("/first", server.url))).text(), typeof seen.path, seen.path.length);
server.reload({
  fetch: () => new Response("new"),
  websocket: { message() {} },
});
console.log(await (await server.fetch(new Request(new URL("/second", server.url)))).text());
server[Symbol.dispose]();
