import { readFileSync } from "node:fs";
const [aPath, bPath, listPath] = process.argv.slice(2);
const list = new Set(readFileSync(listPath, "utf8").split("\n").filter(Boolean));
const load = path => { const map = new Map(); for (const line of readFileSync(path, "utf8").split("\n")) { if (!line) continue; const r = JSON.parse(line); if (r.done || "start" in r) continue; map.set(r.config + "\t" + r.file, r); } return map; };
const A = load(aPath), B = load(bPath);
const groups = { "all": f => true, "ts+tsx": f => /\.tsx?$/.test(f), "tsx": f => /\.tsx$/.test(f), "d.ts": f => /\.d\.ts$/.test(f), "mts+cts": f => /\.[mc]ts$/.test(f) };
const out = {};
for (const [key, a] of A) {
  const b = B.get(key); if (!b || !list.has(a.file)) continue;
  for (const [g, test] of Object.entries(groups)) {
    if (!test(a.file)) continue;
    const c = ((out[a.config] ??= {})[g] ??= { total: 0, equal: 0, differ: 0, normalFails: 0, bothFail: 0, normalOnly: 0, lintOnly: 0 });
    c.total++;
    if (a.code !== undefined && b.code !== undefined) { if (a.code === b.code) c.equal++; else c.differ++; }
    else if (a.code !== undefined) c.normalOnly++;
    else { c.normalFails++; if (b.code !== undefined) c.lintOnly++; else c.bothFail++; }
  }
}
for (const [config, gs] of Object.entries(out)) for (const [g, c] of Object.entries(gs)) console.log(config.padEnd(6), g.padEnd(8), JSON.stringify(c));
