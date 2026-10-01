// usage: node classify2.cjs <out.txt of probe.cjs>...   full compare of the first diagnostic: code, start, length, text
const fs = require("fs");
const cats = {};
const bySection = {};
for (const file of process.argv.slice(2).filter(a => !a.startsWith("--"))) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  let section = "", cur = null;
  const flush = () => {
    if (!cur) return;
    const tsc = cur.tsc[0] || "", go = cur.go[0] || "", lint = cur.lint[0] || "";
    const tscParses = tsc.startsWith("parses");
    const ref = go || (tscParses ? "parses" : tsc);
    const refParses = ref.startsWith("parses");
    let cat;
    if (!lint) cat = "nolint";
    else {
      const lintParses = lint.startsWith("parses");
      const rm = /^@(\d+)\+(\d+) TS(\d+) (.*)$/.exec(ref);
      const lm = /=> TS(\d+) @(\d+)\+(\d+) (.*?)(  \(\d+ messages\))?$/.exec(lint);
      if (refParses && lintParses) cat = "same: both parse";
      else if (refParses) cat = "B ref parses, lint rejects";
      else if (lintParses) cat = "A ref rejects, lint parses";
      else if (rm && lm && rm[3] === lm[1] && rm[1] === lm[2] && rm[2] === lm[3] && rm[4] === lm[4]) cat = "same: both reject, same diagnostic";
      else if (rm && lm && rm[3] === lm[1] && rm[1] === lm[2] && rm[2] === lm[3]) cat = "C0 same code and range, other text";
      else if (rm && lm && rm[3] === lm[1]) cat = "C1 same code, other range";
      else if (rm && lm) cat = "C2 other code";
      else cat = "C3 lint has no code";
    }
    (cats[cat] ||= []).push({ section, ...cur, ref });
    ((bySection[section] ||= {})[cat] ||= 0);
    bySection[section][cat]++;
    cur = null;
  };
  for (const l of lines) {
    if (l.startsWith("## ")) { flush(); section = l.slice(3); continue; }
    if (!l.startsWith("   ")) { flush(); if (l.trim()) cur = { src: l, tsc: [], go: [], bun: [], lint: [] }; continue; }
    if (!cur) continue;
    let m;
    if ((m = /^   tsc (.*)$/.exec(l))) cur.tsc.push(m[1]);
    else if ((m = /^   go  (.*)$/.exec(l))) { if (!m[1].startsWith("parses") || !cur.go.length) cur.go.push(m[1]); }
    else if ((m = /^   bun (.*)$/.exec(l))) cur.bun.push(m[1]);
    else if ((m = /^   lint (.*)$/.exec(l))) cur.lint.push(m[1]);
  }
  flush();
}
const want = process.argv.find(a => a.startsWith("--cat="));
if (!want) {
  for (const [k, v] of Object.entries(cats).sort()) console.log(String(v.length).padStart(5), k);
  if (process.argv.includes("--sections")) for (const [s, c] of Object.entries(bySection)) console.log(s, JSON.stringify(c));
} else {
  const key = Object.keys(cats).find(k => k.startsWith(want.slice(6)));
  for (const r of cats[key] || []) console.log(`[${r.section.slice(0, 22)}] ${r.src}  ||  ref ${r.ref}  ||  lint ${r.lint[0]}`);
}
