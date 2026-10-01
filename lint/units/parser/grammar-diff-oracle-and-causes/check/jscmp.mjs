import { readFileSync } from "node:fs";
for (const name of ["targeted", "sub"]) {
  const read = p => new Map(readFileSync(p, "utf8").split("\n").filter(Boolean).map(l => { const r = JSON.parse(l); return [r.src, r.vals]; }));
  const a = read(`/tmp/gdo/js.base.${name}.jsonl`), b = read(`/tmp/gdo/js.head.${name}.jsonl`);
  const count = {};
  const ex = {};
  for (const [src, av] of a) {
    const bv = b.get(src);
    if (!bv) { count.missing = (count.missing ?? 0) + 1; continue; }
    for (let k = 0; k < 2; k++) {
      if (JSON.stringify(av[k]) === JSON.stringify(bv[k])) continue;
      const cls = `${av[k][0] === "e" ? "R" : "A"}>${bv[k][0] === "e" ? "R" : "A"} ${k ? "jsx" : "js"}`;
      count[cls] = (count[cls] ?? 0) + 1;
      (ex[cls] ??= []).length < 4 && ex[cls].push([src, av[k][1].slice(0, 50), bv[k][1].slice(0, 50)]);
    }
  }
  console.log(name, a.size, "sources", count);
  for (const [cls, list] of Object.entries(ex)) if (!cls.startsWith("R>R")) for (const e of list) console.log("   ", cls, JSON.stringify(e));
}
