function tag() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work + 6;
}
let sum=0;
function visit(f){ let work=0; for(let i=0;i<2;i++) work=(work+i)|0; sum+=f()+work; }
function go(fn){ const list=[fn,fn]; for(let t=0;t<50;t++) list.forEach(visit); return sum; }
let last = "";
for (let turn = 0; turn < 60; turn++) last = go(tag);
console.log(String(last).length > 0);
console.log(String((()=>{try{structuredClone(tag)}catch(e){return e.name}})()));
for (let turn = 0; turn < 3; turn++) last = go(tag);
console.log(String(last));
