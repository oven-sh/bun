// usage: node both-reject.cjs <join.jsonl>... [--examples=N] [--reference=go|tsc]
// Class "RR" (the reference and the lint parse reject): the first diagnostic of the reference against the entry of the first error of the lint parse,
// sorted into the entries of "Known differences from the first diagnostic of the reference" of API.md (KD1 to KD8) and what that list does not name.
const fs = require("node:fs");
const args = process.argv.slice(2);
const flag = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const joins = args.filter(a => !a.startsWith("--"));
const nExamples = Number(flag("examples") ?? 2);
const reference = flag("reference") ?? "go";
const LIST = new Set([1135, 1137, 1136, 1138, 1139, 1131, 1132, 1134, 1180, 1181]);
const SCANNER = new Set([1121, 1124, 1125, 1127, 1198, 1199, 1351, 1489, 6188, 6189, 1161]);
const reader = r => (r.ctx === null ? "statement" : r.ctx === "alias" ? "alias" : r.ctx === "iextends" ? "iextends" : r.ctx === "heritage" ? "implements" : r.ctx === "targ" || r.ctx === "ternary" || r.ctx === "arrowret" || r.ctx === "angle" ? "attempt" : "build");
function classify(r, t) {
  const l = r.lint;
  if (l.code === 0) return SCANNER.has(t[0]) ? "KD8 a code of the scanner: no entry" : "NEW no entry for the message of Bun";
  if (l.code === t[0]) {
    if (l.start === t[1] && l.end === t[2] && l.ref === t[3]) return "SAME code, range and text";
    if (l.start === t[1] && l.end === t[2]) return t[0] === 1005 && t[3] === "',' expected." ? "KD1 TS1005: the reference asks for `,`" : t[0] === 1005 ? "NEW TS1005 at the same place with another token" : "NEW same code and range, other text";
    if (l.start === t[1]) return "NEW same code and start, other end";
    if (t[0] === 1003 && l.start === r.src.length) return "KD7 TS1003 at the end of the file";
    return "NEW same code at another place";
  }
  if ([1434, 1435, 1440, 1228].includes(t[0]) && l.code === 1005) return "KD2 TS1434/1435/1440/1228 -> TS1005";
  if ([1442, 1441, 1436, 1144].includes(t[0]) && l.code === 1005) return "KD3 TS1442/1441/1436/1144 -> TS1005";
  if (LIST.has(t[0]) && (l.code === 1109 || l.code === 1110)) return "KD4 a list diagnostic -> TS1109/TS1110";
  if (t[0] === 1005 && (l.code === 1109 || l.code === 1110)) return "KD4 TS1005 for the closing token -> TS1109/TS1110";
  if (t[0] === 1129 && l.code === 1128) return "KD5 TS1129 -> TS1128";
  if ([1130, 1472].includes(t[0]) && l.code === 1005) return "KD6 TS1130/TS1472 -> TS1005";
  return "NEW another code";
}
for (const path of joins) {
  const rows = fs.readFileSync(path, "utf8").split("\n").filter(l => l.includes('"lint":{')).map(l => JSON.parse(l)).filter(r => (reference === "go" ? r.cls : r.clsTsc) === "RR");
  const table = new Map();
  const readers = ["build", "attempt", "alias", "iextends", "implements", "statement"];
  for (const r of rows) {
    const t = reference === "go" ? r.go : r.tsc;
    const k = classify(r, t);
    if (!table.has(k)) table.set(k, { n: 0, by: {}, pairs: new Map() });
    const e = table.get(k);
    e.n++;
    e.by[reader(r)] = (e.by[reader(r)] ?? 0) + 1;
    const pair = r.lint.code === 0 ? `TS${t[0]} -> none` : r.lint.code === t[0] ? `TS${t[0]}` : `TS${t[0]} -> TS${r.lint.code}`;
    if (!e.pairs.has(pair)) e.pairs.set(pair, []);
    e.pairs.get(pair).push([r, t]);
  }
  console.log(`${path}: ${rows.length} sources that both reject (reference: ${reference})`);
  console.log(["class", "count", ...readers].join("\t"));
  for (const [k, e] of [...table].sort((a, b) => a[0].localeCompare(b[0]))) console.log([k, e.n, ...readers.map(x => e.by[x] ?? 0)].join("\t"));
  if (nExamples === 0) continue;
  for (const [k, e] of [...table].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (k.startsWith("SAME")) continue;
    console.log(`== ${k}: ${e.n}`);
    for (const [pair, list] of [...e.pairs].sort((a, b) => b[1].length - a[1].length).slice(0, 40)) {
      const by = {};
      for (const [r] of list) by[reader(r)] = (by[reader(r)] ?? 0) + 1;
      console.log(`   ${String(list.length).padStart(6)}  ${pair}   (${Object.entries(by).sort((a, b) => b[1] - a[1]).map(([x, n]) => `${x} ${n}`).join(", ")})`);
      const seen = new Set();
      for (const [r, t] of list) {
        const sig = reader(r) + "|" + r.lint.bun.replace(/"[^"]*"/g, '"_"') + "|" + t[3] + "|" + r.lint.ref;
        if (seen.has(sig)) continue;
        seen.add(sig);
        if (seen.size > nExamples) break;
        console.log(`             ${JSON.stringify(r.src)}  ref TS${t[0]} ${t[1]}..${t[2]} ${JSON.stringify(t[3])} | lint TS${r.lint.code} ${r.lint.start}..${r.lint.end} ${JSON.stringify(r.lint.ref)} [bun at ${r.lint.at}: ${JSON.stringify(r.lint.bun)}]`);
      }
    }
  }
}
