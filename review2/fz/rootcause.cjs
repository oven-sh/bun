const fs=require('fs');
const rows=['red-O.jsonl','red-X2.jsonl','red-X1.jsonl'].flatMap(f=>fs.readFileSync(f,'utf8').split('\n').filter(Boolean).map(l=>({...JSON.parse(l),lvl:f.slice(4,-6)})));
const red=rows.filter(r=>r.reduced);
const forms=new Set(red.map(r=>r.sig.replace(/\b(out|err)\{/g,'P{')));
console.log(`reduced ${red.length} seeds (${rows.length-red.length} no longer differed on re-run) -> ${forms.size} distinct minimal scenarios`);
function cause(r){
  const sc=r.sc; const pipes=Object.values(sc.pipes); const two=pipes.length===2;
  const acts=pipes.flatMap(p=>p.actions.filter(a=>a!=='none'));
  const anyExit=pipes.some(p=>p.at==='exit'); const late=pipes.some(p=>['imm','t25','t105','spawn','tick'].includes(p.at));
  const imm=acts.some(a=>/imm|t5|t105/.test(a))||pipes.some(p=>(p.mode==='paused'||p.mode.startsWith('readable'))&&/imm|t5|t105/.test(p.second)&&p.mode!=='readable');
  const ending=sc.w.ending;
  const nodeFatal=r.node.includes('process exit 1');
  if(!sc.ue && nodeFatal){
    const i=r.node.indexOf('process exit 1'); const extra=r.other.slice(i).filter(l=>!/^(process exit|status)/.test(l));
    const has=re=>extra.some(l=>re.test(l));
    if(two && has(/^(out|err) /)) { /* which pipe threw */ const m=/^(out|err) (data|read)#/.exec(r.node[i-1]||''); const p=m?m[1]:'?'; if(extra.some(l=>/^(out|err) /.test(l)&&!l.startsWith(p+' '))) return 'R1a fatal throw, then the sibling pipe still delivers'; }
    if(has(/^(out|err) (data|read)#/)) return 'R1d fatal throw, then the same listener is called again';
    if(has(/^(out|err) end$/)||has(/^child close/)) return "R1c fatal throw on a chunk handed over by flow()/resume(), then 'end' / 'close'";
    if(has(/^child exit/)) return "R1b fatal throw, then the child's 'exit'";
    return 'R1x fatal throw, then other callbacks';
  }
  if(pipes.some(p=>p.mode==='paused'&&p.at==='exit')) return "N2 Node's exit-time flush resumes a stream the program paused (Node quirk)";
  if(pipes.some(p=>['imm','t25','t105'].includes(p.at)) && acts.length===0) return "N1 consumer attached on setImmediate/timer after a fast child: Node has already flushed the data away / phase order";
  if(anyExit) return "D2 consumer attached in the child's 'exit': chunk and EOF handed over together";
  if(acts.length===0 && pipes.every(p=>p.at==='sync') && (ending==='exit')) return "D1a EOF in the turn of the last chunk: 'end' before the child's 'exit'";
  if(imm && (ending==='exit'||ending==='hangup')) return "D1b EOF in the turn of the last chunk: 'end' before a setImmediate/timer of the listener";
  if(pipes.some(p=>p.mode==='paused') ) return "N2 Node's exit-time flush resumes a stream the program paused (Node quirk)";
  return 'misc';
}
const t=new Map();
for(const r of red){const c=cause(r);if(!t.has(c))t.set(c,{n:0,seeds:[],forms:new Set()});const x=t.get(c);x.n++;x.seeds.push(r.seed);x.forms.add(r.sig.replace(/\b(out|err)\{/g,'P{'));}
for(const [c,x] of [...t.entries()].sort((a,b)=>b[1].n-a[1].n)){console.log(`${String(x.n).padStart(4)} seeds, ${String(x.forms.size).padStart(2)} minimal forms  ${c}   e.g. ${x.seeds.slice(0,8).join(',')}`); if(c==='misc'||process.argv.includes('--forms'))for(const f of x.forms)console.log('        '+f);}
