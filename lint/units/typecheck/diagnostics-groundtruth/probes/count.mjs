import fs from "node:fs";
const ts = JSON.parse(fs.readFileSync("/workspace/ref/typescript-go/_submodules/TypeScript/src/compiler/diagnosticMessages.json","utf8"));
const ex = JSON.parse(fs.readFileSync("/workspace/ref/typescript-go/internal/diagnostics/extraDiagnosticMessages.json","utf8"));
const tsKeys = Object.keys(ts), exKeys = Object.keys(ex);
console.log("ts entries", tsKeys.length, "extra entries", exKeys.length);
// duplicates by code inside each
function byCode(o){ const m=new Map(); const dups=[]; for(const [k,v] of Object.entries(o)){ if(m.has(v.code)) dups.push([v.code,m.get(v.code).key,k]); m.set(v.code,{...v,key:k}); } return {m,dups}; }
const a=byCode(ts), b=byCode(ex);
console.log("ts distinct codes", a.m.size, "dups", JSON.stringify(a.dups));
console.log("extra distinct codes", b.m.size, "dups", JSON.stringify(b.dups));
const coll=[]; for(const [c,v] of b.m){ if(a.m.has(c)) coll.push([c,a.m.get(c).key,v.key, a.m.get(c).category, v.category]); }
console.log("collisions", coll.length);
for(const c of coll) console.log(JSON.stringify(c));
const merged=new Map(a.m); for(const [c,v] of b.m) merged.set(c,v);
console.log("merged", merged.size);
const cats={}; for(const v of merged.values()) cats[v.category]=(cats[v.category]||0)+1;
console.log(cats);
// property sets
const props=new Set(); for(const v of merged.values()) for(const k of Object.keys(v)) props.add(k);
console.log([...props]);
let ru=0, rd=0, el=0; for(const v of merged.values()){ if(v.reportsUnnecessary) ru++; if(v.reportsDeprecated) rd++; if(v.elidedInCompatabilityPyramid) el++; }
console.log({ru,rd,el});
const codes=[...merged.keys()].sort((x,y)=>x-y); console.log("min",codes[0],"max",codes[codes.length-1]);
let total=0, maxlen=0, maxkey=""; for(const v of merged.values()){ total+=Buffer.byteLength(v.key); if(Buffer.byteLength(v.key)>maxlen){maxlen=Buffer.byteLength(v.key);maxkey=v.key;} }
console.log("total text bytes", total, "max", maxlen);
// non-ascii
let na=0; for(const v of merged.values()){ if(/[^\x00-\x7f]/.test(v.key)) {na++; console.log("nonascii", v.code, JSON.stringify(v.key));} }
console.log("nonascii count", na);
