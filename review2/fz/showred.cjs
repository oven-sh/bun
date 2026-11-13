// cluster reduced scenarios by signature and print one example per cluster
const fs=require('fs');const rows=fs.readFileSync(process.argv[2],'utf8').split('\n').filter(Boolean).map(JSON.parse);
const cl=new Map();let notrepro=[];
for(const r of rows){ if(!r.reduced){notrepro.push(r.seed);continue;} const k=r.sig.replace(/\b(out|err)\{/g,'P{'); if(!cl.has(k))cl.set(k,[]); cl.get(k).push(r);}
console.log(`reduced ${rows.length-notrepro.length}, did not differ on re-run: ${notrepro.join(',')||'none'}; clusters: ${cl.size}`);
const full=process.argv.includes('--full');
for(const [k,v] of [...cl.entries()].sort((a,b)=>b[1].length-a[1].length)){
  console.log(`\n#### x${v.length}  ${k}   seeds ${v.map(r=>r.seed).join(',')}`);
  if(full){const r=v[0];const a=r.node,b=r.other;console.log('   node'.padEnd(45)+'other');for(let i=0;i<Math.max(a.length,b.length);i++){const x=a[i]??'',y=b[i]??'';console.log((x===y?'   ':' ! ')+x.padEnd(42)+y);}}
}
