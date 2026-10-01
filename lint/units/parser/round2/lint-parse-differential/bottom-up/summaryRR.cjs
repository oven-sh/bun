// Class RR of join2 files, condensed: pairs (code of tsc, code of the lint parse), and the messages of the lint parse that have no code.
//   node summaryRR.cjs <join2.jsonl>...
const fs = require("fs");
const readline = require("readline");
const files = process.argv.slice(2);
const KEYWORDS = new Set("break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with as implements interface let package private protected public static yield abstract any asserts bigint boolean declare get infer is keyof module namespace never readonly require number object set string symbol type undefined unique unknown from global override of out accessor await async satisfies using defer constructor intrinsic".split(" "));
const shape = text => text.replace(/"[^"]*"/g, '"_"').replace(/^Unexpected .*$/, "Unexpected _").replace(/but found .*$/, "but found _").replace(/^Expected "_"/, 'Expected "_"');
const pairs = new Map(), nocode = new Map(), range = new Map(), args = new Map();
let n = 0;
const add = (m, k, r) => { let g = m.get(k); if (!g) m.set(k, (g = { ts: 0, tsx: 0, ex: r })); g[r.d]++; if (r.src.length < g.ex.src.length) g.ex = r; };
(async () => {
  for (const file of files) {
    const rl = readline.createInterface({ input: fs.createReadStream(file) });
    for await (const line of rl) {
      if (!line.includes('"cls":"RR"')) continue;
      const r = JSON.parse(line);
      if (r.cls !== "RR") continue;
      n++;
      const [code, start, end, text] = r.tsc[0];
      const l = r.lint;
      if (!l.code) { add(nocode, shape(l.bun), r); continue; }
      if (l.code !== code) { add(pairs, `tsc TS${code} -> lint TS${l.code}`, r); continue; }
      if (l.start !== start || l.end !== end) add(range, `TS${code} ${l.start < start ? "lint starts before tsc" : l.start > start ? "lint starts after tsc" : l.end < end ? "same start, lint shorter" : "same start, lint longer"}`, r);
      else if (text !== l.ref) add(args, `TS${code} tsc "${text}" lint "${l.ref}"`, r);
    }
  }
  const show = (title, m, top) => {
    const rows = [...m].sort((a, b) => b[1].ts + b[1].tsx - a[1].ts - a[1].tsx);
    const sum = rows.reduce((s, [, g]) => s + g.ts + g.tsx, 0);
    console.log(`\n== ${title}: ${sum} parses, ${rows.length} rows`);
    for (const [k, g] of rows.slice(0, top)) console.log(`${String(g.ts).padStart(6)} ts ${String(g.tsx).padStart(6)} tsx  ${k}   e.g. [${g.ex.d}] ${JSON.stringify(g.ex.src)} tsc TS${g.ex.tsc[0][0]}@${g.ex.tsc[0][1]}..${g.ex.tsc[0][2]} lint ${g.ex.lint.code ? `TS${g.ex.lint.code}@${g.ex.lint.start}..${g.ex.lint.end}` : `@${g.ex.lint.off}+${g.ex.lint.len}`} ${JSON.stringify(g.ex.lint.bun)}`);
    if (rows.length > top) console.log(`       ... ${rows.length - top} more rows, ${rows.slice(top).reduce((s, [, g]) => s + g.ts + g.tsx, 0)} parses`);
  };
  console.log(`${n} parses where both reject`);
  show("the code differs", pairs, 80);
  show("the lint parse has no code (by the shape of its message)", nocode, 60);
  show("the code is equal, the range differs", range, 30);
  show("code and range equal, the text differs", args, 30);
})();
