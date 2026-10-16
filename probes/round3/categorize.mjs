import fs from "node:fs";
const load = f => new Map(fs.readFileSync(f, "utf8").trim().split("\n").map(l => JSON.parse(l)).map(r => [r.key, r.report]));
const [fa, fb] = process.argv.slice(2);
const a = load(fa), b = load(fb);
const cats = {};
const strip = r => r.map(e => e.replace(/^inside the call: /, ""));
for (const [key, ra] of a) {
  const rb = b.get(key);
  const x = JSON.stringify(ra), y = JSON.stringify(rb);
  let cat;
  if (x === y) cat = "same";
  else if (JSON.stringify(strip(rb)) === x) cat = "only-inside-the-call";
  else if (JSON.stringify(strip(rb).map(e => e.split(":")[0]).sort()) === JSON.stringify(ra.map(e => e.split(":")[0]).sort())) cat = "same-entries-other-order-or-codes";
  else cat = "different-entries";
  const state = key.split(" | ")[1];
  (cats[cat] ??= {})[state] = ((cats[cat] ??= {})[state] ?? 0) + 1;
  if (process.argv[4] && cat === process.argv[4]) console.log(key, "\n   node:", x, "\n   other:", y);
}
console.log(fb, JSON.stringify(cats, null, 0));
