// usage: node analyze.cjs <inputs.jsonl> <bun.jsonl> <class> [max examples per key]
// class X: tsc reports a parse diagnostic and the parse pass of bun accepts. Y: tsc parses and the parse pass of bun
// rejects. Z: both reject. V: tsc parses, the parse pass accepts and the visit pass rejects. Prints the counts of all
// classes, then the inputs of <class> by key (X: code of tsc; Y, V: message of bun; Z: code of tsc and message of bun).
const fs = require("node:fs");
const read = f => fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const inputs = read(process.argv[2]);
const bun = new Map(read(process.argv[3]).map(r => [r.i, r]));
const want = process.argv[4] || "X";
const max = Number(process.argv[5] || 6);
const generic = m => m.replace(/"[^"]*"/g, '"…"').replace(/\d+/g, "N");
const counts = {};
const byKey = new Map();
for (const r of inputs) {
  const b = bun.get(r.i);
  if (!b) continue;
  let cls;
  if (r.t && !b.scan) cls = "X";
  else if (!r.t && b.scan) cls = "Y";
  else if (r.t && b.scan) cls = "Z";
  else if (!r.t && !b.scan && b.full) cls = "V";
  else cls = "ok";
  counts[r.g + " " + cls] = (counts[r.g + " " + cls] || 0) + 1;
  if (cls !== want) continue;
  const key = cls === "X" ? "TS" + r.t[0] + (b.full ? " (visit: " + generic(b.full[2]) + ")" : "")
    : cls === "Y" ? generic(b.scan[2])
    : cls === "V" ? generic(b.full[2])
    : "TS" + r.t[0] + " | " + generic(b.scan[2]);
  if (!byKey.has(key)) byKey.set(key, []);
  byKey.get(key).push({ r, b });
}
console.log(JSON.stringify(counts, null, 1));
for (const [key, list] of [...byKey].sort((a, b) => b[1].length - a[1].length)) {
  console.log("## " + key + "  (" + list.length + ")");
  for (const { r, b } of list.slice(0, max)) {
    const t = r.t ? ` tsc TS${r.t[0]}@${r.t[1]}+${r.t[2]}` : " tsc parses";
    const s = b.scan ? ` bun @${b.scan[0]}+${b.scan[1]} ${b.scan[2]}` : b.full ? ` bun visit @${b.full[0]} ${b.full[2]}` : " bun accepts";
    console.log("   " + JSON.stringify(r.s) + "  [" + r.m + "]" + t + " |" + s);
  }
}
