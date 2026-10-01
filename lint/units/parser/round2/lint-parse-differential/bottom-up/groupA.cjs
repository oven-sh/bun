// Class A of join2 files (tsc parses, the lint parse rejects), grouped.
//   node groupA.cjs <join2.jsonl>... [--valid=N|G|all] [--plain=accepts|rejects|all] [--opt=only|no|all] [--ex=2] [--key=msg|msgctx]
// --valid=N: no grammar error of the checker; G: one. --plain: what the parse pass without lint does (scanImports of the release binary).
// --opt=only: the lint parse with the options of the tests accepts (the options of `bun --lint` reject); no: both reject.
const fs = require("fs");
const readline = require("readline");
const args = process.argv.slice(2);
const flag = (n, d) => (args.find(a => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const files = args.filter(a => !a.startsWith("--"));
const want = { valid: flag("valid", "all"), plain: flag("plain", "all"), opt: flag("opt", "all") };
const nex = Number(flag("ex", "2"));
const keyKind = flag("key", "msg");
const KEYWORDS = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with as implements interface let package private protected public static yield abstract any asserts bigint boolean declare get infer is keyof module namespace never readonly require number object set string symbol type undefined unique unknown from global override of out accessor await async satisfies using defer".split(" "));
const norm = text => text.replace(/but found "([^"]*)"/, (m, tok) => (/^[A-Za-z_$][\w$]*$/.test(tok) && !KEYWORDS.has(tok) ? 'but found <name>' : m)).replace(/^Unexpected "?([A-Za-z_$][\w$]*)"?$/, (m, tok) => (KEYWORDS.has(tok) ? m : "Unexpected <name>")).replace(/^"[^"]*" has already been declared$/, '"<name>" has already been declared').replace(/^The constant "[^"]*" must be initialized$/, 'The constant "<name>" must be initialized').replace(/ \(token: \w+\)$/, "");
const groups = new Map();
let total = 0;
(async () => {
  for (const file of files) {
    const rl = readline.createInterface({ input: fs.createReadStream(file) });
    for await (const line of rl) {
      if (!line.includes('"cls":"A"')) continue;
      const r = JSON.parse(line);
      if (r.cls !== "A") continue;
      const valid = r.chk && r.chk.length === 0 ? "N" : "G";
      if (want.valid !== "all" && want.valid !== valid) continue;
      const plain = r.scan === null ? "accepts" : "rejects";
      if (want.plain !== "all" && want.plain !== plain) continue;
      const opt = r.lintPlain ? "no" : "only";
      if (want.opt !== "all" && want.opt !== opt) continue;
      total++;
      const l = r.lint;
      const g1 = valid === "N" ? "no grammar error" : `checker TS${r.chk[0][0]}`;
      const key = `${g1} | plain ${plain}${r.full === null ? "" : "/full rejects"}${opt === "only" ? " | only with the options of --lint" : ""} | lint TS${l.code || "----"} ${norm(l.bun)}` + (keyKind === "msgctx" ? ` | ${r.ctx}` : "");
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { ts: 0, tsx: 0, ex: [], prods: new Map(), ctxs: new Map(), srcs: new Set() }));
      g[r.d]++;
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
    console.log(`${String(g.ts).padStart(5)} ts ${String(g.tsx).padStart(5)} tsx  ${key}`);
    for (const e of g.ex) console.log(`        [${e.d}] ${JSON.stringify(e.src)}  lint at ${e.lint.off}+${e.lint.len}${e.chk && e.chk.length ? `  checker TS${e.chk[0][0]} at ${e.chk[0][1]}: ${e.chk[0][3]}` : ""}${e.scan ? `  plain: ${e.scan[0]}` : ""}`);
    console.log(`        prods ${top(g.prods)} | ctxs ${top(g.ctxs)}`);
  }
})();
