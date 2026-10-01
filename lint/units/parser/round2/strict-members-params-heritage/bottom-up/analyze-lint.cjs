// usage: node analyze-lint.cjs <inputs.jsonl> <bun.jsonl> <lint.tsv> <class> [max examples per key]
// class LX: tsc reports a parse diagnostic and a lint parse accepts. LY: tsc parses and a lint parse rejects.
// LZ: both reject (key: code of tsc, code of the entry of the lint parse, same start or not). SL: the parse pass
// without lint accepts and a lint parse rejects. LS: the parse pass without lint rejects and a lint parse accepts.
const fs = require("node:fs");
const read = f => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const inputs = read(process.argv[2]);
const bun = new Map(read(process.argv[3]).map(r => [r.i, r]));
const lint = new Map(fs.readFileSync(process.argv[4], "utf8").split("\n").filter(Boolean).map(l => { const f = l.split("\t"); return [Number(f[0]), f]; }));
const want = process.argv[5] || "LX";
const max = Number(process.argv[6] || 6);
const unhex = h => Buffer.from(h || "", "hex").toString("utf8");
const generic = m => m.replace(/"[^"]*"/g, '"…"').replace(/\d+/g, "N");
const counts = {};
const byKey = new Map();
for (const r of inputs) {
  const b = bun.get(r.i), f = lint.get(r.i);
  if (!b || !f) continue;
  const ok = f[1] === "ok";
  const classes = [];
  if (r.t && ok) classes.push("LX");
  if (!r.t && !ok) classes.push("LY");
  if (r.t && !ok) classes.push("LZ");
  if (!b.scan && !ok) classes.push("SL");
  if (b.scan && ok) classes.push("LS");
  for (const c of classes) counts[r.g + " " + c] = (counts[r.g + " " + c] || 0) + 1;
  if (!classes.includes(want)) continue;
  let key;
  if (want === "LX") key = "TS" + r.t[0];
  else if (want === "LZ") key = "tsc TS" + r.t[0] + " | lint " + (f[4] !== "0" ? "TS" + f[4] : "no code: " + generic(unhex(f[8]))) + (Number(f[2]) === r.t[1] ? " | same start" : " | other start");
  else key = (f[4] && f[4] !== "0" ? "TS" + f[4] + " " : "") + generic(unhex(f[8]) || (b.scan ? b.scan[2] : ""));
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push({ r, b, f });
}
console.log(JSON.stringify(counts, null, 1));
for (const [key, list] of [...byKey].sort((a, b) => b[1].length - a[1].length)) {
  console.log("## " + key + "  (" + list.length + ")");
  for (const { r, b, f } of list.slice(0, max)) {
    const t = r.t ? ` tsc TS${r.t[0]}@${r.t[1]}+${r.t[2]}` : " tsc parses";
    const l = f[1] === "ok" ? " lint parses" : ` lint @${f[2]}+${f[3]} ${unhex(f[8])}` + (f[4] !== "0" ? ` => TS${f[4]}@${f[5]}+${f[6] - f[5]}` : "");
    const s = b.scan ? ` scan @${b.scan[0]} ${b.scan[2]}` : " scan accepts";
    console.log("   " + JSON.stringify(r.s) + "  [" + r.m + "]" + t + " |" + l + " |" + s);
  }
}
