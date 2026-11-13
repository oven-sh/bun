// attribution per stratum of scenarios
const fs=require('fs');const {HANDLER,MARKER}=require('/tmp/fz/lib.cjs');const {gen}=require('/tmp/fz/gen3.cjs');
const rows=fs.readFileSync(process.argv[2],'utf8').split('\n').filter(Boolean).map(JSON.parse);
const by=new Map();for(const r of rows){if(!by.has(r.seed))by.set(r.seed,{});by.get(r.seed)[r.rt]=r.traces;}
const isClose=l=>/^(out|err) close$/.test(l);
function rle(s){const runs=[];for(const m of s.matchAll(/([A-Za-z])(\d+)/g)){if(runs.length&&runs[runs.length-1][0]===m[1])runs[runs.length-1][1]+=+m[2];else runs.push([m[1],+m[2]]);}return runs.map(r=>r[0]+r[1]).join('');}
function keys(l,sc){
  const raw=l.join('\n');
  if(!sc.ue&&l.includes('process exit 1')){let last=-1;l.forEach((x,i)=>{if(HANDLER.test(x))last=i;});l=l.filter((x,i)=>!(i>last&&MARKER.test(x)));}
  l=l.filter(x=>!isClose(x)).concat(l.filter(isClose).sort());
  l=l.filter(x=>{const m=/^(out|err) (tick|micro)#(\d+)$/.exec(x);return !(m&&sc.pipes[m[1]]&&sc.pipes[m[1]].actions[+m[3]-1]==='throw');});
  l=l.filter(x=>!x.startsWith('UR ')).concat(l.filter(x=>x.startsWith('UR ')).sort());
  const g=l.join('\n');
  const per={};for(const p of ['out','err'])per[p]=l.filter(x=>x.startsWith(p+' ')||((x.startsWith('UE ')||x.startsWith('UR '))&&x.includes(`-${p}-`)));
  const rest=l.filter(x=>!x.startsWith('out ')&&!x.startsWith('err ')&&!x.startsWith('UE ')&&!x.startsWith('UR ')).sort();
  const x1=JSON.stringify(per)+'\n'+rest.join('\n');
  const o={bytes:{out:'',err:''},rest:rest.slice()};
  for(const p of ['out','err'])for(const y of per[p]){const m=HANDLER.exec(y);if(m){o.bytes[p]+=m[4];o.rest.push(`${p} call`);}else if(/^(out|err) (end|close|error .*)$/.test(y)||y.startsWith('UE ')||y.startsWith('UR '))o.rest.push(y);}
  for(const p of ['out','err'])o.bytes[p]=rle(o.bytes[p]);o.rest.sort();
  return {raw,g,x1,o:JSON.stringify(o)};
}
const strata={
 "every consumer is a 'data' listener attached at spawn":sc=>Object.values(sc.pipes).every(p=>p.mode==='data'&&['sync','tick','spawn'].includes(p.at)),
 "  ... and one pipe only":sc=>Object.values(sc.pipes).length===1&&Object.values(sc.pipes).every(p=>p.mode==='data'&&['sync','tick','spawn'].includes(p.at)),
 "some consumer attached in the child's 'exit'":sc=>Object.values(sc.pipes).some(p=>p.at==='exit'),
 "some consumer attached on setImmediate or a timer":sc=>Object.values(sc.pipes).some(p=>['imm','t25','t105'].includes(p.at)),
 "some consumer is not a plain 'data' listener (readable, paused, for await, resume)":sc=>Object.values(sc.pipes).some(p=>p.mode!=='data'),
 "all":sc=>true,
};
for(const [name,f] of Object.entries(strata)){
  let n=0,raw=0,g=0,x1=0,o=0;
  for(const [seed,s] of by){const sc=gen(seed);if(!f(sc))continue;n++;
    const a=s.node.map(t=>keys(t,sc)),b=s.arm.map(t=>keys(t,sc));
    const d=k=>{const sa=new Set(a.map(x=>x[k]));return !b.some(x=>sa.has(x[k]));};
    if(d('raw'))raw++; if(d('g'))g++; if(d('x1'))x1++; if(d('o'))o++;}
  console.log(`${name}: ${n} seeds; differ raw ${raw}; after the four Bun-wide differences ${g}; in a pipe's own order or the outcome ${x1}; in the outcome ${o}`);
}
