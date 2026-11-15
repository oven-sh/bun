const seen: unknown[] = [];
function handle(request: any) { seen.push(typeof request.method, request.extra); return new Response("x"); }
const server = Bun.serve({ port: 0, fetch: handle });
handle({ method: 5, extra: "plain" });
await fetch(server.url);
handle({ method: 6, extra: "again" });
await server.stop(true);
console.log(seen.join());
