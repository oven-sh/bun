const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  idleTimeout: 5,
  development: false,
  routes: {
    "/cookies": request => {
      const seen = request.cookies.get("visits");
      request.cookies.set("visits", String(Number(seen ?? 0) + 1), { path: "/", httpOnly: true });
      request.cookies.delete("old");
      return Response.json({ seen, names: [...request.cookies.keys()].sort() });
    },
    "/redirect": Response.redirect("/cookies", 303),
  },
  fetch(request, server) {
    const address = server.requestIP(request);
    server.timeout(request, 10);
    return Response.json({ address: address.address, family: address.family, port: address.port > 0, pending: server.pendingRequests, url: request.url.replace(/:\d+/, ":PORT") });
  },
});
console.log(server.hostname, typeof server.port, server.url.protocol, server.development, typeof server.id, server.pendingRequests, server.pendingWebSockets);
console.log(await (await fetch(server.url + "who?x=1")).json());
const cookies = await fetch(server.url + "cookies", { headers: { cookie: "visits=4; old=1; other=x" } });
console.log(await cookies.json(), cookies.headers.getSetCookie());
console.log((await fetch(server.url + "redirect", { redirect: "manual" })).status);
server.reload({ routes: {}, fetch: () => new Response("reloaded") });
console.log(await (await fetch(server.url + "cookies")).text());
server.unref();
server.ref();
await server.stop();
console.log(await fetch(server.url).catch(error => error.code));
