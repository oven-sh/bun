import { readFileSync } from "node:fs";
const read = p => readFileSync(p, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l));
const [pa, pb, show = 8] = process.argv.slice(2);
const a = read(pa), b = read(pb);
const count = {};
const ex = {};
for (let i = 0; i < a.length; i++) {
  const x = a[i], y = b[i];
  if (JSON.stringify(x) === JSON.stringify(y)) { count.equal = (count.equal ?? 0) + 1; continue; }
  let cls;
  const k = r => r.e ? "R" : r.threw ? "T" : "A";
  if (k(x) !== k(y)) cls = `${k(x)}>${k(y)}`;
  else if (k(x) === "R") cls = "R>R errors differ";
  else if (k(x) === "T") cls = "T>T";
  else if (x.js !== y.js) cls = "A>A js differs";
  else if (x.mappings !== y.mappings) cls = "A>A same js, MAPPINGS differ";
  else if (JSON.stringify(x.names) !== JSON.stringify(y.names)) cls = "A>A same js, names differ";
  else cls = "A>A same js and map, warnings differ";
  count[cls] = (count[cls] ?? 0) + 1;
  (ex[cls] ??= []).length < Number(show) && ex[cls].push([x.src, x.mappings ?? x.e ?? x.threw, y.mappings ?? y.e ?? y.threw, x.w, y.w]);
}
console.log(pa, "vs", pb, a.length, JSON.stringify(count));
for (const [cls, list] of Object.entries(ex)) if (cls.includes("same js")) for (const e of list) console.log("  ", cls, JSON.stringify(e).slice(0, 500));
