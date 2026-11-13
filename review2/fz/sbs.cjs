// side by side of canonical traces: node sbs.cjs file seed [rtA rtB]
const fs=require('fs');const {gen}=require(require('path').resolve(process.env.FZ_GEN||'/tmp/fz/gen.cjs'));
const [file,seed,A='node',B='arm']=process.argv.slice(2);
const rows=fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(r=>r.seed==+seed);
const sc=gen(+seed, JSON.parse(process.env.FZ_GENOPTS||'{}'));delete sc.meta;console.log(JSON.stringify(sc));
const canon=r=>{const m=new Map();for(const t of r.traces){const k=t.join('\n');m.set(k,(m.get(k)||0)+1);}const e=[...m.entries()].sort((a,b)=>b[1]-a[1]);return {lines:e[0][0].split('\n'),n:e.length};};
const a=canon(rows.find(r=>r.rt===A)),b=canon(rows.find(r=>r.rt===B));
console.log(`${A} (${a.n} distinct)`.padEnd(44)+`${B} (${b.n} distinct)`);
for(let i=0;i<Math.max(a.lines.length,b.lines.length);i++){const x=a.lines[i]??'',y=b.lines[i]??'';console.log((x===y?'  ':'! ')+x.padEnd(42)+y);}
