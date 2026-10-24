// A name is stored directly on two objects of a layout. Stores under keys that only the run knows follow, on one of them and on a third object, with other types.
const names = JSON.parse('["late", "x"]');
function record(i) {
  return { x: i, y: i + 1 };
}
function read(o) {
  return o.late;
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
let out = [];
for (const o of [a, b, c, d]) out.push(typeof read(o), typeof o.x, Object.keys(o).join("+"), JSON.stringify(o));
console.log(out.join(" | "));
let sum = 0;
for (let i = 0; i < 10000; i++) {
  const v = read(i % 3 === 0 ? a : i % 3 === 1 ? b : c);
  sum += typeof v === "string" ? v.length : typeof v === "number" ? v : 1000;
}
console.log(sum);
