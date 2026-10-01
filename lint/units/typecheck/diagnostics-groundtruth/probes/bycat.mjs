import fs from "node:fs";
const ts = JSON.parse(fs.readFileSync("/workspace/ref/typescript-go/_submodules/TypeScript/src/compiler/diagnosticMessages.json","utf8")), ex = JSON.parse(fs.readFileSync("/workspace/ref/typescript-go/internal/diagnostics/extraDiagnosticMessages.json","utf8"));
const m = new Map(); for (const [k,v] of Object.entries(ts)) m.set(v.code,{...v,text:k}); for (const [k,v] of Object.entries(ex)) m.set(v.code,{...v,text:k});
const by = {}; for (const v of m.values()) { by[v.category] ??= {n:0,bytes:0}; by[v.category].n++; by[v.category].bytes += v.text.length; }
console.log(by);
const ranges = {}; for (const v of m.values()) { const r = Math.floor(v.code/1000)*1000; ranges[r] ??= {n:0,bytes:0}; ranges[r].n++; ranges[r].bytes += v.text.length; } console.log(ranges);
// flags
for (const v of m.values()) if (v.reportsUnnecessary||v.reportsDeprecated||v.elidedInCompatabilityPyramid) console.log(v.code, v.category, v.reportsUnnecessary?"U":"", v.elidedInCompatabilityPyramid?"E":"", v.reportsDeprecated?"D":"", v.text.slice(0,70));
// identical text collisions
const ident = [1549, 5112].map(c => [c, ts[Object.keys(ts).find(k=>ts[k].code===c)], ex[Object.keys(ex).find(k=>ex[k].code===c)]]); console.log(JSON.stringify(ident));
