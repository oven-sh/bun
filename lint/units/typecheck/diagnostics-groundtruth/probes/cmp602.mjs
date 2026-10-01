import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire("/workspace/wt/typecheck/package.json");
const ts = require("typescript");
console.log("ts.version", ts.version);
const D = ts.Diagnostics;
const names = Object.keys(D);
console.log("ts.Diagnostics entries", names.length);
const byCode = new Map();
for (const n of names) { const d = D[n]; byCode.set(d.code, { name:n, ...d }); }
console.log("distinct codes", byCode.size);
const sub = JSON.parse(fs.readFileSync("/workspace/ref/typescript-go/_submodules/TypeScript/src/compiler/diagnosticMessages.json","utf8"));
const ex = JSON.parse(fs.readFileSync("/workspace/ref/typescript-go/internal/diagnostics/extraDiagnosticMessages.json","utf8"));
const subBy = new Map(); for (const [k,v] of Object.entries(sub)) subBy.set(v.code, {...v, text:k});
const catName = ["Warning","Error","Suggestion","Message"];
let onlySub=[], only602=[], textDiff=[], catDiff=[], flagDiff=[];
for (const [c,v] of subBy) { const t=byCode.get(c); if(!t){onlySub.push(c); continue;} if(t.message!==v.text) textDiff.push([c,t.message,v.text]); if(catName[t.category]!==v.category) catDiff.push([c,catName[t.category],v.category]); if(!!t.reportsUnnecessary!==!!v.reportsUnnecessary||!!t.reportsDeprecated!==!!v.reportsDeprecated||!!t.elidedInCompatabilityPyramid!==!!v.elidedInCompatabilityPyramid) flagDiff.push(c);}
for (const [c] of byCode) if(!subBy.has(c)) only602.push(c);
console.log("only in submodule json:", onlySub.length, onlySub.slice(0,40).join(","));
console.log("only in ts 6.0.2:", only602.length, only602.slice(0,40).join(","));
console.log("text differs:", textDiff.length); for (const t of textDiff.slice(0,10)) console.log("  ", JSON.stringify(t));
console.log("category differs:", catDiff.length, JSON.stringify(catDiff.slice(0,5)));
console.log("flags differ:", flagDiff.length, flagDiff.join(","));
// key naming in ts 6.0.2 vs go key
const sample = byCode.get(2322); console.log(JSON.stringify(sample));
const s2 = byCode.get(1005); console.log(JSON.stringify(s2));
