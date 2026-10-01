import fs from "node:fs";
const ts = JSON.parse(fs.readFileSync("/workspace/ref/typescript-go/_submodules/TypeScript/src/compiler/diagnosticMessages.json","utf8"));
const ex = JSON.parse(fs.readFileSync("/workspace/ref/typescript-go/internal/diagnostics/extraDiagnosticMessages.json","utf8"));
const merged = new Map();
for (const [k,v] of Object.entries(ts)) merged.set(v.code, {...v, key:k});
for (const [k,v] of Object.entries(ex)) merged.set(v.code, {...v, key:k});
const list=[...merged.values()].sort((a,b)=>a.code-b.code);
function isLetterOrDigit(ch){ return /[\p{L}\p{Nd}]/u.test(ch); }
function convertPropertyName(orig, code){
  let b="";
  for (const r of orig){
    if (r==="*") b+="_Asterisk"; else if (r==="/") b+="_Slash"; else if (r===":") b+="_Colon";
    else if (!isLetterOrDigit(r)) b+="_"; else b+=r;
  }
  let v=b.replace(/_+/g,"_");
  v=v.replace(/^_+(\D)/,"$1");
  v=v.replace(/_$/,"");
  let key=v; if (Buffer.byteLength(key)>100) key=key.slice(0,100);
  key=key+"_"+code;
  // token.IsExported: first rune is upper-case letter
  const first=v[0];
  const exported=/\p{Lu}/u.test(first);
  if(!exported){ v = (v[0]==="_" ? "X" : "X_") + v; }
  return [v,key];
}
// parse Go generated
const go=fs.readFileSync("/workspace/ref/typescript-go/internal/diagnostics/diagnostics_generated.go","utf8");
const re=/^var (\S+) = &Message\{code: (\d+), category: Category(\w+), key: ("(?:[^"\\]|\\.)*"), text: ("(?:[^"\\]|\\.)*")(.*)\}$/gm;
let m; const goList=[];
while((m=re.exec(go))){ goList.push({name:m[1],code:+m[2],category:m[3],key:JSON.parse(m[4]),text:JSON.parse(m[5]),rest:m[6]}); }
console.log("go", goList.length, "mine", list.length);
let bad=0; const names=new Set(); let x_=0, x=0;
for(let i=0;i<list.length;i++){
  const a=list[i], g=goList[i];
  const [vn,key]=convertPropertyName(a.key,a.code);
  const rest=(a.reportsUnnecessary?", reportsUnnecessary: true":"")+(a.elidedInCompatabilityPyramid?", elidedInCompatibilityPyramid: true":"")+(a.reportsDeprecated?", reportsDeprecated: true":"");
  if(names.has(vn)) {console.log("DUP NAME", vn);} names.add(vn);
  if(vn.startsWith("X_")) x_++; else if(vn.startsWith("X")&&!/^X[a-z]/.test(vn)) x++;
  if(vn!==g.name||key!==g.key||a.key!==g.text||a.code!==g.code||a.category!==g.category||rest!==g.rest){ bad++; if(bad<10) console.log("MISMATCH", JSON.stringify({vn,key,text:a.key,code:a.code,cat:a.category,rest}), JSON.stringify(g)); }
}
console.log("mismatches", bad, "distinct names", names.size, "X_ prefixed", x_);
// escapes in go text
let esc=0; for(const g of goList){ if(/\\/.test(JSON.stringify(g.text).slice(1,-1).replace(/\\"/g,""))) {esc++; if(esc<8) console.log("ESC", g.code, JSON.stringify(g.text));} }
console.log("texts with backslash escapes other than quote:", esc);
// key truncation count
let trunc=0; for(const a of list){ const [vn,key]=convertPropertyName(a.key,a.code); if(vn.length>100) trunc++; }
console.log("names longer than 100 (key truncated):", trunc);
// keys unique
const keys=new Set(goList.map(g=>g.key)); console.log("distinct keys", keys.size);
// names starting with X followed by digit
console.log(goList.filter(g=>/^X_?\d/.test(g.name)).slice(0,5).map(g=>g.name));
console.log(goList.filter(g=>/^X[^_]/.test(g.name) && !ts[g.text]?.code && false).length);
