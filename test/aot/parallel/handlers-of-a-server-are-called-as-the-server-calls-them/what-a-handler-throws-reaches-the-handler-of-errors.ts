const kept = { code: 7, note: "mine" };
function read(o: { code: number }) { let work = 0; for (let k = 0; k < 2; k++) work += k; return o.code; }
const before = read(kept);
const server = Bun.serve({ port: 0, fetch() { throw kept; }, error(e: any) { e.code = "changed"; e.more = 1; return new Response("handled " + e.note); } });
const answer = await (await fetch(server.url)).text();
await server.stop(true);
console.log(before, answer, read(kept), typeof kept.code, Object.keys(kept).join());
