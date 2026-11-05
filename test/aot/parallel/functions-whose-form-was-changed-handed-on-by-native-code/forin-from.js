function tag() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work + 6;
}
function visit(f){ let work=0; for(let i=0;i<2;i++) work=(work+i)|0; return f()+work; }
function go(fn){ return String(Array.from(new Set([fn]),visit)); }
let last = "";
for (let turn = 0; turn < 60; turn++) last = go(tag);
console.log(String(last).length > 0);
console.log(String((()=>{let n=0;for(const k in tag)n++;return n})()));
for (let turn = 0; turn < 3; turn++) last = go(tag);
console.log(String(last));
