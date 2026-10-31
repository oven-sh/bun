// A store under a key that only the run knows reaches a name that is a field of the layout because another object is stored to by name. A validating build aborts where a proof is false.
// Flags: --aot-validate
const names = JSON.parse('["late", "x"]');
function record(i) {
  return { x: i, y: i + 1 };
}
function lengthOf(o) {
  return o.late.length;
}
const a = record(1);
a.late = "text";
const b = record(2);
b.late = "more";
b[names[0]] = 7;
const c = record(3);
c[names[0]] = { inner: 1 };
c[names[1]] = "not a number";
const d = record(4);
d[names[0]] = 5;
const e = record(5);
console.log(a.late, b.late, JSON.stringify(c.late), c.x, d.late, e.late);
let total = 0;
for (let i = 0; i < 4000; i++) {
  const length = lengthOf(i & 1 ? a : d);
  total += length === undefined ? 100 : length;
}
console.log(total);
for (const o of [a, b, c, d, e]) console.log(Object.keys(o).join(), JSON.stringify(o));
