import fs from "node:fs";
const go=fs.readFileSync("/workspace/ref/typescript-go/internal/diagnostics/diagnostics_generated.go","utf8");
const re=/^var (\S+) = &Message\{code: (\d+), category: Category(\w+), key: ("(?:[^"\\]|\\.)*"), text: ("(?:[^"\\]|\\.)*")(.*)\}$/gm;
let m; const byName=new Map();
while((m=re.exec(go))) byName.set(m[1],{code:+m[2],cat:m[3],key:JSON.parse(m[4]),text:JSON.parse(m[5])});
const use=require("node:zlib").gunzipSync(fs.readFileSync(new URL("../data/msguse.tsv.gz", import.meta.url))).toString().trim().split("\n").map(l=>l.split("\t"));
function size(pk){ const s=new Set(use.filter(u=>pk.includes(u[0])).map(u=>u[1])); let b=0,kb=0,nb=0; for(const n of s){const e=byName.get(n); b+=Buffer.byteLength(e.text); kb+=e.key.length; nb+=n.length;} return {count:s.size,textBytes:b,keyBytes:kb}; }
console.log("binder+checker", size(["binder","checker"]));
console.log("+scanner+parser", size(["binder","checker","scanner","parser"]));
let all=0, keys=0, names=0, maxName=0; for(const [n,e] of byName){all+=Buffer.byteLength(e.text); keys+=e.key.length; names+=n.length; maxName=Math.max(maxName,n.length);} console.log("all", byName.size, "text", all, "keys", keys, "names", names, "maxName", maxName);
// placeholders stats
let maxIdx=-1, withPh=0, gaps=0; const odd=[];
for(const [n,e] of byName){ const idx=[...e.text.matchAll(/\{(\d+)\}/g)].map(x=>+x[1]); if(idx.length){withPh++; const mx=Math.max(...idx); maxIdx=Math.max(maxIdx,mx); const set=new Set(idx); for(let i=0;i<=mx;i++) if(!set.has(i)){gaps++; odd.push([e.code,e.text]); break;} }
  if(/\{[^}\d][^}]*\}|\{\}/.test(e.text)) odd.push(["brace",e.code,e.text]); }
console.log({withPh,maxIdx,gaps});
for(const o of odd.slice(0,40)) console.log(JSON.stringify(o));
// leading zeros or huge
for(const [n,e] of byName){ if(/\{0\d+\}/.test(e.text)) console.log("leading zero", e.code); }
