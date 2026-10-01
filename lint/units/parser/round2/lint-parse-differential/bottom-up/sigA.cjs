// Class A of join2 files (tsc parses, the lint parse rejects): where the error of the lint parse is in the tree of tsc.
//   node sigA.cjs <join2.jsonl>... [--ex=2] > groups.txt
// Signature: the kinds of the innermost node of tsc that holds the offset of the error and of its three ancestors, and what tsc as a whole reports
// (the first grammar error of the checker, else the other codes without those of names that nothing declares).
const fs = require("fs");
const readline = require("readline");
const ts = require(process.env.ORACLE_TYPESCRIPT ?? "/workspace/wt/parser/node_modules/typescript/lib/typescript.js");
const args = process.argv.slice(2);
const flag = (n, d) => (args.find(a => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const files = args.filter(a => !a.startsWith("--"));
const DEPTH = Number(flag("depth", "4"));
const nex = Number(flag("ex", "2"));
const NOISE = new Set([2304, 2307, 7006, 2564, 2503, 7008, 2552, 7005, 7010, 7031, 7019, 2792, 2300, 2451, 7034, 7053, 2339, 2322, 2345, 2554, 2558, 2314, 2315, 2749, 2693, 2362, 2363, 2365, 2367, 18046, 18048, 2532, 2531, 2454, 2448, 2695, 2349, 2351, 2344, 2694, 2724, 2709, 2502, 2635, 7022, 7023, 7024, 2391, 2389, 2394, 2384, 2355, 2378, 2377, 2376, 1016, 2370, 2371, 2390, 2393, 2300, 2428, 2430, 2420, 2415, 2416, 2417, 2411, 2413, 2374, 2375, 2373, 2372]);
const toUtf16 = (src, byte) => Buffer.from(src, "utf8").subarray(0, byte).toString("utf8").length;
function nodeAt(sf, pos) {
  let best = sf;
  const visit = node => {
    if (node.pos <= pos && pos < node.end) { best = node; ts.forEachChild(node, visit); }
    else if (node.pos <= pos && pos === node.end && node.end === sf.end) { best = node; ts.forEachChild(node, visit); }
  };
  ts.forEachChild(sf, visit);
  return best;
}
const kind = n => ts.SyntaxKind[n.kind];
const groups = new Map();
let total = 0;
(async () => {
  for (const file of files) {
    const rl = readline.createInterface({ input: fs.createReadStream(file) });
    for await (const line of rl) {
      if (!line.includes('"cls":"A"')) continue;
      const r = JSON.parse(line);
      if (r.cls !== "A") continue;
      total++;
      const sf = ts.createSourceFile(`/input.${r.d}`, r.src, ts.ScriptTarget.ESNext, true, r.d === "tsx" ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
      const off = Math.max(0, r.lint.off);
      let node = nodeAt(sf, toUtf16(r.src, off));
      const path = [];
      for (let n = node, k = 0; n && n.kind !== ts.SyntaxKind.SourceFile && k < DEPTH; n = n.parent, k++) path.push(kind(n));
      const what = r.chk.length ? `checker TS${r.chk[0][0]}` : (() => { const o = (r.oth || []).filter(c => !NOISE.has(c)); return o.length ? `semantic TS${o.join(",TS")}` : "nothing"; })();
      const plain = r.scan === null ? (r.full === null ? "plain accepts" : "parse pass accepts, visit rejects") : "plain rejects";
      const opt = r.lintPlain ? "" : " (options of --lint only)";
      const key = `${path.join(" < ")} | tsc: ${what} | ${plain}${opt}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { ts: 0, tsx: 0, ex: [], srcs: new Set(), msgs: new Map(), ctxs: new Map() }));
      g[r.d]++;
      const m = `TS${r.lint.code || "----"} ${r.lint.bun}`;
      g.msgs.set(m, (g.msgs.get(m) ?? 0) + 1);
      g.ctxs.set(r.ctx ?? r.prod, (g.ctxs.get(r.ctx ?? r.prod) ?? 0) + 1);
      if (!g.srcs.has(r.src)) {
        g.srcs.add(r.src);
        g.ex.push(r);
        g.ex.sort((a, b) => a.src.length - b.src.length);
        if (g.ex.length > nex) g.ex.pop();
      }
    }
  }
  const top = (m, k) => [...m].sort((a, b) => b[1] - a[1]).slice(0, k).map(([key, n]) => `${key}:${n}`).join(" | ");
  console.log(`${total} parses in ${groups.size} groups`);
  for (const [key, g] of [...groups].sort((a, b) => b[1].ts + b[1].tsx - a[1].ts - a[1].tsx)) {
    console.log(`${String(g.ts).padStart(5)} ts ${String(g.tsx).padStart(5)} tsx  ${g.srcs.size} sources  ${key}`);
    for (const e of g.ex) console.log(`        [${e.d}] ${JSON.stringify(e.src)} @${e.lint.off}`);
    console.log(`        lint: ${top(g.msgs, 3)}`);
    console.log(`        in: ${top(g.ctxs, 8)}`);
  }
})();
