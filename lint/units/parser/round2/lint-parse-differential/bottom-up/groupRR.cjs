// Class RR of join2 files: tsc and the lint parse both reject. The first diagnostic of tsc against the entry of the first error of the lint parse.
//   node groupRR.cjs <join2.jsonl>... [--ex=2] [--detail=1]
// same: code, start and end equal. same-code: code equal, range differs. other-code: both have a code, they differ. no-code: the lint parse has no entry.
const fs = require("fs");
const readline = require("readline");
const args = process.argv.slice(2);
const flag = (n, d) => (args.find(a => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const files = args.filter(a => !a.startsWith("--"));
const nex = Number(flag("ex", "2"));
const detail = flag("detail", "1") === "1";
const KEYWORDS = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with as implements interface let package private protected public static yield abstract any asserts bigint boolean declare get infer is keyof module namespace never readonly require number object set string symbol type undefined unique unknown from global override of out accessor await async satisfies using defer constructor intrinsic".split(" "));
const norm = text => text.replace(/"([^"]*)"/g, (m, tok) => (/^[A-Za-z_$][\w$]*$/.test(tok) && !KEYWORDS.has(tok) ? "<name>" : /^#/.test(tok) ? "<#name>" : /^['"`]/.test(tok) || /^\d/.test(tok) ? "<literal>" : m)).replace(/^Unexpected ([A-Za-z_$][\w$]*)$/, (m, tok) => (KEYWORDS.has(tok) ? m : "Unexpected <name>")).replace(/ \(token: \w+\)$/, "");
const totals = {};
const groups = new Map();
(async () => {
  for (const file of files) {
    const corpus = file.replace(/^.*j2\./, "").replace(/\.jsonl$/, "");
    const rl = readline.createInterface({ input: fs.createReadStream(file) });
    for await (const line of rl) {
      if (!line.includes('"cls":"RR"')) continue;
      const r = JSON.parse(line);
      if (r.cls !== "RR") continue;
      const [code, start, end, text] = r.tsc[0];
      const l = r.lint;
      let kind;
      if (l.stage === "panic") kind = "panic";
      else if (!l.code) kind = "no-code";
      else if (l.code !== code) kind = "other-code";
      else if (l.start === start && l.end === end) kind = "same";
      else if (l.start === start) kind = "same-code-same-start";
      else kind = "same-code-other-range";
      const tk = `${corpus} ${r.d} ${kind}`;
      totals[tk] = (totals[tk] ?? 0) + 1;
      const key = kind === "same" ? `same | TS${code}` : kind === "no-code" ? `no-code | tsc TS${code} ${text.replace(/'[^']*'/g, "'_'")} | lint: ${norm(l.bun)}` : kind === "other-code" ? `other-code | tsc TS${code} ${text.replace(/'[^']*'/g, "'_'")} | lint TS${l.code} ${l.ref.replace(/'[^']*'/g, "'_'")}` : `${kind} | TS${code} ${text.replace(/'[^']*'/g, "'_'")} | lint ${l.ref.replace(/'[^']*'/g, "'_'")} ${l.start < start ? "before" : l.start > start ? "after" : l.end < end ? "shorter" : "longer"}`;
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { ts: 0, tsx: 0, ex: [], srcs: new Set(), arg: new Map() }));
      g[r.d]++;
      if (kind === "same-code-same-start" || kind === "same-code-other-range" || kind === "same") {
        const a = `${text} / ${l.ref}`;
        g.arg.set(a, (g.arg.get(a) ?? 0) + 1);
      }
      if (!g.srcs.has(r.src)) {
        g.srcs.add(r.src);
        g.ex.push(r);
        g.ex.sort((a, b) => a.src.length - b.src.length);
        if (g.ex.length > nex) g.ex.pop();
      }
    }
  }
  for (const key of Object.keys(totals).sort()) console.log(`${String(totals[key]).padStart(7)}  ${key}`);
  if (!detail) return;
  console.log(`${groups.size} groups`);
  for (const [key, g] of [...groups].sort((a, b) => b[1].ts + b[1].tsx - a[1].ts - a[1].tsx)) {
    console.log(`${String(g.ts).padStart(6)} ts ${String(g.tsx).padStart(6)} tsx ${String(g.srcs.size).padStart(6)} src  ${key}`);
    if (key.startsWith("same |")) { const diff = [...g.arg].filter(([a]) => { const [x, y] = a.split(" / "); return x !== y; }); if (diff.length) console.log(`        texts that differ: ${diff.sort((a, b) => b[1] - a[1]).slice(0, 5).map(([a, n]) => `${a}: ${n}`).join(" | ")}`); continue; }
    for (const e of g.ex) console.log(`        [${e.d}] ${JSON.stringify(e.src)}  tsc TS${e.tsc[0][0]}@${e.tsc[0][1]}..${e.tsc[0][2]} ${JSON.stringify(e.tsc[0][3])} | lint ${e.lint.code ? `TS${e.lint.code}@${e.lint.start}..${e.lint.end}` : `@${e.lint.off}+${e.lint.len}`} ${JSON.stringify(e.lint.bun)}`);
  }
})();
