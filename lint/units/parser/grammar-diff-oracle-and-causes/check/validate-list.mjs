// Scratch: is a static code list equal to what tsc 6.0.2 reports through its grammar functions, on both corpora?
import { readFileSync } from "node:fs";
import { D1, E1, loadJsonl } from "./lib.mjs";
const M = [1231, 1232, 1233, 1234, 1235, 1258, 2822, 2880];
const LIST = new Set([...D1, ...E1, ...M]);
LIST.delete(2300);
let programs = 0;
const miss = new Map(), extra = new Map();
for (const corpus of ["targeted", "small"]) {
  for (const r of loadJsonl(`/tmp/gdo/chk.${corpus}.jsonl.gz`)) {
    for (const [key, c] of Object.entries(r.c)) {
      if (c.threw) continue;
      programs++;
      const byList = c.sem.filter(d => LIST.has(d[0]) && (d[0] !== 2304 || /^Cannot find name '#/.test(d[3] ?? "")));
      const listCodes = new Set(byList.map(d => d[0]));
      const giCodes = new Set(c.gi);
      for (const code of giCodes) if (!listCodes.has(code)) { if (!miss.has(code)) miss.set(code, { n: 0, ex: [] }); const e = miss.get(code); e.n++; if (e.ex.length < 3) e.ex.push(r.src); }
      for (const code of listCodes) if (!giCodes.has(code)) { if (!extra.has(code)) extra.set(code, { n: 0, ex: [] }); const e = extra.get(code); e.n++; if (e.ex.length < 3) e.ex.push(r.src); }
    }
  }
}
console.log(programs, "programs");
console.log("reported through a grammar function of tsc 6.0.2, code not in the list (or filtered):");
for (const [code, e] of [...miss].sort((a, b) => a[0] - b[0])) console.log("  ", code, e.n, e.ex.map(s => JSON.stringify(s).slice(0, 70)).join("  "));
console.log("code in the list, reported by tsc 6.0.2 outside its grammar functions:");
for (const [code, e] of [...extra].sort((a, b) => a[0] - b[0])) console.log("  ", code, e.n, e.ex.map(s => JSON.stringify(s).slice(0, 70)).join("  "));
