const fs=require('fs');const {gen}=require(process.env.FZ_GEN||'/tmp/fz/gen3.cjs');
const [file,seed,opts='{}']=process.argv.slice(2);
const rows=fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(JSON.parse).filter(r=>r.seed==+seed);
const sc=gen(+seed,JSON.parse(opts));delete sc.meta;console.log(JSON.stringify(sc));
const canon=r=>{const m=new Map();for(const t of r.traces){const k=t.join('\n');m.set(k,(m.get(k)||0)+1);}const e=[...m.entries()].sort((a,b)=>b[1]-a[1]);return {lines:e[0][0].split('\n'),n:e.length};};
const rts=['node','arm','base'].filter(rt=>rows.find(r=>r.rt===rt));const c=rts.map(rt=>canon(rows.find(r=>r.rt===rt)));
console.log(rts.map((rt,i)=>`${rt} (${c[i].n})`.padEnd(40)).join(''));
const max=Math.max(...c.map(x=>x.lines.length));
for(let i=0;i<max;i++){const l=c.map(x=>x.lines[i]??'');console.log((l[0]===l[1]?' ':'!')+' '+l.map(x=>x.padEnd(40)).join(''));}
