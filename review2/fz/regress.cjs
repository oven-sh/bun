// seeds where base agrees with node at a layer but arm does not (possible regressions), and the reverse (fixed)
const fs=require('fs');const {layers,differs}=require('/tmp/fz/lib.cjs');
const [file,genPath='/tmp/fz/gen3.cjs']=process.argv.slice(2);const {gen}=require(genPath);
const rows=fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(JSON.parse);
const by=new Map();for(const r of rows){if(!by.has(r.seed))by.set(r.seed,{});by.get(r.seed)[r.rt]=r.traces;}
for(const L of ['L0','L1','L2','L3']){
  const reg=[],fix=[],both=[],none=[];
  for(const [seed,s] of [...by.entries()].sort((a,b)=>a[0]-b[0])){
    const sc=gen(seed);
    const da=differs(s.node,s.arm,sc,L), db=differs(s.node,s.base,sc,L);
    (da&&!db?reg:!da&&db?fix:da&&db?both:none).push(seed);
  }
  console.log(`${L}: arm differs, base agrees (regression candidates) ${reg.length}; base differs, arm agrees (fixed) ${fix.length}; both differ ${both.length}; neither ${none.length}`);
  console.log(`   regression candidates: ${reg.join(',')}`);
}
