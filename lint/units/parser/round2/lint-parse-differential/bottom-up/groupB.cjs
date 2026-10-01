// Class B of join2 files: tsc reports a parse diagnostic, the lint parse accepts. Grouped by the first diagnostic of tsc (code and text) and, with --by=prod, by production.
//   node groupB.cjs <join2.jsonl>... [--ex=3] [--by=code|codeprod|codectx]
const fs = require("fs");
const readline = require("readline");
const args = process.argv.slice(2);
const flag = (n, d) => (args.find(a => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const files = args.filter(a => !a.startsWith("--"));
const nex = Number(flag("ex", "3"));
const by = flag("by", "code");
const groups = new Map();
let total = 0;
(async () => {
  for (const file of files) {
    const rl = readline.createInterface({ input: fs.createReadStream(file) });
    for await (const line of rl) {
      if (!line.includes('"cls":"B"')) continue;
      const r = JSON.parse(line);
      if (r.cls !== "B") continue;
      total++;
      const [code, , , text] = r.tsc[0];
      const key = `TS${code} ${text}` + (by === "codeprod" ? ` | ${r.prod}` : by === "codectx" ? ` | ${r.ctx}` : "");
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { ts: 0, tsx: 0, ex: [], srcs: new Set(), prods: new Map(), ctxs: new Map(), plainR: 0 }));
      g[r.d]++;
      if (r.scan) g.plainR++;
      g.prods.set(r.prod, (g.prods.get(r.prod) ?? 0) + 1);
      g.ctxs.set(r.ctx, (g.ctxs.get(r.ctx) ?? 0) + 1);
      if (!g.srcs.has(r.src)) {
        g.srcs.add(r.src);
        g.ex.push(r);
        g.ex.sort((a, b) => a.src.length - b.src.length);
        if (g.ex.length > nex) g.ex.pop();
      }
    }
  }
  const top = m => [...m].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, n]) => `${k}:${n}`).join(" ");
  console.log(`${total} parses in ${groups.size} groups`);
  for (const [key, g] of [...groups].sort((a, b) => b[1].ts + b[1].tsx - a[1].ts - a[1].tsx)) {
    console.log(`${String(g.ts).padStart(5)} ts ${String(g.tsx).padStart(5)} tsx  ${g.srcs.size} sources  ${key}${g.plainR ? `  (the parse pass without lint rejects ${g.plainR})` : ""}`);
    for (const e of g.ex) console.log(`        [${e.d}] ${JSON.stringify(e.src)}  tsc at ${e.tsc[0][1]}..${e.tsc[0][2]}${e.tsc.length > 1 ? ` (+${e.tsc.length - 1} more: ${e.tsc.slice(1, 3).map(d => "TS" + d[0]).join(",")})` : ""}`);
    console.log(`        prods ${top(g.prods)} | ctxs ${top(g.ctxs)}`);
  }
})();
