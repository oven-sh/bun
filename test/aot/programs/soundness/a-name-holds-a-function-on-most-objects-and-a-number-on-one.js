// A name holds a function on most objects of a layout. On others a store under a key that only the run knows puts a number or another function there.
const names = JSON.parse('["late"]');
function record(i) {
  return { x: i };
}
function withMethod(i) {
  const o = record(i);
  o.late = function () {
    return this.x + 1;
  };
  return o;
}
function call(o) {
  try {
    return o.late();
  } catch (e) {
    return e.constructor.name;
  }
}
const a = withMethod(1);
const b = withMethod(2);
const c = record(3);
c[names[0]] = 5;
const d = withMethod(4);
d[names[0]] = () => "replaced";
const e = record(5);
e[names[0]] = function () {
  return this.x * 10;
};
console.log(call(a), call(b), call(c), call(d), call(e));
let total = "";
for (let i = 0; i < 5000; i++) {
  const o = i % 5 === 0 ? a : i % 5 === 1 ? b : i % 5 === 2 ? c : i % 5 === 3 ? d : e;
  const r = call(o);
  if (i > 4990) total += r + ",";
}
console.log(total, typeof a.late, typeof c.late, Object.keys(c).join());
