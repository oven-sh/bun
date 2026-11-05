function tag() {
  let work = 0;
  for (let i = 0; i < 2; i++) work = (work + i) | 0;
  return work + 6;
}
function go(fn){ const list=[fn,fn,fn,fn]; for(let t=0;t<50;t++) list.sort(compare); return list[0]()+list.length; }
function compare(a,b){ let work=0; for(let i=0;i<2;i++) work=(work+i)|0; return a()-b()+work-1; }
let last = "";
for (let turn = 0; turn < 60; turn++) last = go(tag);
console.log(String(last).length > 0);
console.log(String(Reflect.ownKeys(tag).length>0));
for (let turn = 0; turn < 3; turn++) last = go(tag);
console.log(String(last));
