// Class A of a join: tsc parses, the lint parse rejects. Grouped by the message of bun (quoted tokens kept), with counts per dialect and one example.
//   node classA.cjs <join.jsonl> [--by=msg|prod|ctx] [--max=N]
const fs = require("fs");
const args = process.argv.slice(2);
const flag = (n, d) => (args.find(a => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const file = args.find(a => !a.startsWith("--"));
const by = flag("by", "msg");
const groups = new Map();
for (const line of fs.readFileSync(file, "utf8").split("\n")) {
  if (!line) continue;
  const r = JSON.parse(line);
  if (r.cls !== "A") continue;
  const l = r.lint;
  const key = by === "msg" ? `TS${l.code || "----"} ${l.bun}` : by === "prod" ? `${r.prod}` : `${r.ctx}`;
  let g = groups.get(key);
  if (!g) groups.set(key, (g = { ts: 0, tsx: 0, ex: r, prods: new Map(), ctxs: new Map() }));
  g[r.d]++;
  g.prods.set(r.prod, (g.prods.get(r.prod) ?? 0) + 1);
  g.ctxs.set(r.ctx, (g.ctxs.get(r.ctx) ?? 0) + 1);
  if (r.src.length < g.ex.src.length) g.ex = r;
}
const top = m => [...m].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => `${k}:${n}`).join(" ");
for (const [key, g] of [...groups].sort((a, b) => b[1].ts + b[1].tsx - a[1].ts - a[1].tsx)) {
  console.log(`${String(g.ts).padStart(6)} ts ${String(g.tsx).padStart(6)} tsx  ${key}`);
  console.log(`        e.g. [${g.ex.d}] ${JSON.stringify(g.ex.src)} at ${g.ex.lint.off}+${g.ex.lint.len}`);
  console.log(`        prods ${top(g.prods)} | ctxs ${top(g.ctxs)}`);
}
