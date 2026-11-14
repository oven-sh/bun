// A program that runs for a while: Bun.serve with a store behind it and thousands of requests.
type Item = { id: number; name: string; n: number };
const items = new Map<number, Item>(); let next = 1, hits = 0;
const server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(req) {
  hits++; const url = new URL(req.url), m = /^\/items(?:\/(\d+))?$/.exec(url.pathname);
  if (!m) return new Response("no " + url.pathname, { status: 404 });
  if (req.method === "POST") { const body = (await req.json()) as { name: string }; const item = { id: next++, name: body.name, n: 0 }; items.set(item.id, item); return Response.json(item, { status: 201 }); }
  if (!m[1]) return Response.json({ count: items.size, sum: [...items.values()].reduce((s, i) => s + i.n, 0) });
  const item = items.get(+m[1]); if (!item) return new Response("gone", { status: 410 });
  if (req.method === "DELETE") return new Response(String(items.delete(item.id)));
  item.n += +(url.searchParams.get("by") ?? 1); return Response.json(item);
} });
const call = (path: string, init?: RequestInit) => fetch(new URL(path, server.url), init).then(async r => r.status + " " + (await r.text()));
let sum = 0; const statuses: Record<string, number> = {};
for (let round = 0; round < 60; round++) { for (let i = 0; i < 3; i++) sum += (await call("/items", { method: "POST", body: JSON.stringify({ name: "m" + i }) })).length; const all = await Promise.all(Array.from({ length: 100 }, (_, i) => i % 10 === 10 ? call("/items", { method: "POST", body: JSON.stringify({ name: "n" + round }) }) : i % 10 === 9 ? call("/none" + i) : call(`/items/${1 + ((i * 7 + round) % (3 * round + 3))}?by=${i % 3}`))); for (const text of all) { statuses[text.slice(0, 3)] = (statuses[text.slice(0, 3)] ?? 0) + 1; sum += text.length; } }
console.log(hits, JSON.stringify(statuses), await call("/items")); console.log(await call("/items/3", { method: "DELETE" }), await call("/items/3")); server.stop(true);
