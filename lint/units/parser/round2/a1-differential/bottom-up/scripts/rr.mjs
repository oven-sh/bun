// node rr.mjs <x.diffsrc.jsonl> : R>R records by message family (base first message -> head first message) and by what changed.
import { readFileSync } from "node:fs";
const norm = m => m.replace(/"(?:[^"\\]|\\.)*"/g, "…").replace(/^Unexpected .*/, "Unexpected …").replace(/end of file/g, "…").replace(/\(token: \w+\)/, "").trim();
const fam = new Map();
const kinds = new Map();
let records = 0;
const sources = new Set();
for (const line of readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean)) {
  const s = JSON.parse(line);
  for (const r of s.recs) {
    if (r.cls !== "R>R") continue;
    records++;
    sources.add(s.src);
    const b = r.base[1], h = r.head[1];
    const key = `${norm(b[0][0])}  ->  ${norm(h[0][0])}`;
    if (!fam.has(key)) fam.set(key, { n: 0, src: new Set(), ex: s.src, b, h });
    const f = fam.get(key);
    f.n++;
    f.src.add(s.src);
    // what changed
    const samePos0 = b[0][1] === h[0][1] && b[0][2] === h[0][2];
    const sameMsg0 = b[0][0] === h[0][0];
    const kind = sameMsg0 && samePos0 ? (b.length === h.length ? "first error equal, a later one differs" : b.length > h.length ? "first error equal, head has fewer errors" : "first error equal, head has more errors") : samePos0 ? "first error at the same place, another message" : (h[0][1] > b[0][1] || (h[0][1] === b[0][1] && h[0][2] > b[0][2])) ? "head reports first at a later place" : "head reports first at an earlier place";
    if (!kinds.has(kind)) kinds.set(kind, { n: 0, src: new Set(), ex: s.src, b, h });
    kinds.get(kind).n++;
    kinds.get(kind).src.add(s.src);
  }
}
console.log(`${records} R>R records in ${sources.size} sources`);
console.log("BY WHAT CHANGED");
for (const [k, f] of [...kinds].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`${String(f.n).padStart(7)} rec ${String(f.src.size).padStart(5)} src  ${k}`);
  console.log(`          e.g. ${JSON.stringify(f.ex).slice(0, 120)}\n               base ${JSON.stringify(f.b).slice(0, 170)}\n               head ${JSON.stringify(f.h).slice(0, 170)}`);
}
console.log("BY MESSAGE FAMILY (first message of the base -> first message of the head)");
for (const [k, f] of [...fam].sort((a, b) => b[1].n - a[1].n)) {
  console.log(`${String(f.n).padStart(7)} rec ${String(f.src.size).padStart(5)} src  ${k}      e.g. ${JSON.stringify(f.ex).slice(0, 90)}`);
}
