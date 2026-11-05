function tag() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work + 6;
}
function visit(a,f){ let work=0; for(let i=0;i<2;i++) work=(work+i)|0; return a+f()+work; }
function go(fn){ return String([fn,fn].reduce(visit,0)); }
let last = "";
for (let turn = 0; turn < 60; turn++) last = go(tag);
console.log(String(last).length > 0);
console.log(String(typeof new tag()));
for (let turn = 0; turn < 3; turn++) last = go(tag);
console.log(String(last));
