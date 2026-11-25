// Objects that are no lists hold the methods of lists under other names. What runs is the method that the object holds under that name,
// whatever the object has under the method's own name.
const said = [];
let reads = 0;

function any(a) {
  const o = { 0: a, length: 1, any: Array.prototype.some };
  return o.any(x => x);
}
function anyBesideSome(a) {
  const o = { 0: a, length: 1, any: Array.prototype.some, some: () => "its own" };
  return o.any(x => x);
}
function all(a, b) {
  return { length: "2", 0: a, 1: b, all: Array.prototype.every, every() { return "its own"; } }.all(x => x > 0);
}
function first(a, b) {
  const o = Object.assign({ length: 2, 0: a, 1: b, find: () => "its own" }, { first: Array.prototype.find });
  return o.first(x => x > 1);
}
function kept(a, b) {
  const o = { length: 2, 0: a, 1: b, kept: Array.prototype.filter };
  return o.kept(x => x > 0).join("+");
}
function sum(a, b) {
  const o = { length: "2", 0: a, 1: b, 2: 100, sum: Array.prototype.reduce };
  return o.sum((s, x) => s + x);
}
function raised(a) {
  const o = { length: 1, 0: a, raised: Array.prototype.map, map() { return ["its own"]; } };
  return o.raised(x => x + 1)[0];
}
function read(a) {
  const o = { 0: a, length: 1, get some() { reads++; return Array.prototype.some; } };
  return o.some(x => x);
}

for (let i = 0; i < 4; i++) {
  said.push(any(i), anyBesideSome(i), all(i, 2), first(i, 2), kept(i, 2), sum(i, 2), raised(i), read(i));
}
console.log(said.join(), reads);
