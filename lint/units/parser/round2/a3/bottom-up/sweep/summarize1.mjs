import { readFileSync } from "node:fs";
const files = readFileSync("/tmp/a3-seam/glob-files.txt", "utf8").split("\n").filter(Boolean);
const recs = readFileSync(process.argv[2], "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)).filter(r => "index" in r);
const by = [new Map(), new Map()];
for (const r of recs) by[r.config].set(r.index, r);
for (const c of [0, 1]) {
  const fail = [...by[c].values()].filter(r => r.errors && r.index >= 0);
  const ok = [...by[c].values()].filter(r => !r.errors && r.index >= 0);
  console.log(`config ${c}: ok ${ok.length} fail ${fail.length} totalms ${Math.round([...by[c].values()].reduce((a, r) => a + r.ms, 0))} sentinel ${JSON.stringify(by[c].get(-1) ?? null)}`);
  if (c === 0 || process.argv[3]) for (const r of fail) console.log(`  FAIL ${files[r.index]} :: ${r.errors[0].slice(0, 110)}`);
}
const diffFail = [...by[0].values()].filter(r => r.index >= 0 && !!r.errors !== !!by[1].get(r.index)?.errors);
console.log("fail differs between configs:", diffFail.map(r => files[r.index]));
const same = [...by[0].values()].filter(r => r.index >= 0 && !r.errors && by[1].get(r.index)?.hash === r.hash).length;
console.log("config1 output equals config0 output:", same, "differs:", [...by[0].values()].filter(r => r.index >= 0 && !r.errors && by[1].get(r.index)?.hash !== r.hash && !by[1].get(r.index)?.errors).length);
