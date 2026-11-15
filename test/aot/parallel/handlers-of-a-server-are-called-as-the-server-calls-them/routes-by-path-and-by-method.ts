const log: unknown[] = [];
const server = Bun.serve({
  port: 0,
  routes: {
    "/a": request => { log.push("a", request.constructor.name, request.method); return new Response("A"); },
    "/b/:id": { GET(request) { log.push("b", request.params.id); return Response.json({ id: request.params.id }); }, POST: async request => { log.push("post", await request.text()); return new Response("P"); } },
    "/c": new Response("static"),
  },
  fetch(request) { log.push("fallback", new URL(request.url).pathname); return new Response("F", { status: 404 }); },
});
const at = (path: string, init?: RequestInit) => fetch(new URL(path, server.url), init).then(answer => answer.text());
const answers = [await at("/a"), await at("/b/7"), await at("/b/8", { method: "POST", body: "sent" }), await at("/c"), await at("/d")];
await server.stop(true);
console.log(answers.join(), log.join());
