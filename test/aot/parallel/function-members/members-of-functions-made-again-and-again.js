// Each function object has its own.
function make(n) {
  function made() {}
  made.n = n;
  return made;
}
const a = make(1);
const b = make(2);
a.n += 10;
console.log(a.n, b.n);
const all = [];
for (let i = 0; i < 3; i++) {
  const f = () => i;
  f.n = i;
  all.push(f);
}
console.log(all.map(f => f.n).join());
