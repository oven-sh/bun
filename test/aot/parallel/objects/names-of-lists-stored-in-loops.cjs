// A loop stores a name on an object of any kind. The storage of a list moves beside it, and iterations are undone.
let held = null, other = [1, 2, 3];
function grow(count) {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    if (held !== null) held.first = i;
    other.push(i);
    sum += other.length;
  }
  return sum;
}
console.log(grow(10));
held = JSON.parse("[1]", () => other);
for (let k = 0; k < 6; k++) console.log(grow(300), other.first, other.length, other[3], other.at(-1));

let held0;
class Entry { constructor(o) { Object.assign(this, o); } }
const entries = [];
for (let i = 0; i < 16; i++) entries.push(new Entry(JSON.parse('{"first":' + i + ',"second":1}')));
function total(count) {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const o = entries[i & 15];
    if (held0 !== undefined && held0 !== null) held0.first = undefined;
    sum = (sum + o.first + o.second) | 0;
  }
  return sum;
}
function replace(place, text) {
  entries[place] = new Entry(JSON.parse(text));
  console.log(total(5), total(400), total(16));
}
const kinds = [() => entries, () => [1.5], () => new (class extends Array {})(), () => new Map(), () => new Set(), () => () => 1, () => class {}, () => new Error("e"), () => new Date(0), () => /a/, () => new Uint8Array(4), () => Promise.resolve(1), () => Object.defineProperty(JSON.parse('{"first":1}'), "z", { get() { return 1; } }), () => Object.defineProperty(JSON.parse('{"q":1}'), "z", { value: 1 }), () => JSON.parse('{"q":1}')];
for (const make of kinds) {
  held0 = null;
  replace(7, '{"first":7,"second":1}');
  replace(6, "{}");
  held0 = JSON.parse("[1]", make);
  replace(7, '{"a":1,"b":2,"c":3,"d":4,"e":5,"f":6,"g":7,"first":8,"h":9,"second":10}');
  console.log(Object.keys(held0).includes("first"), Object.prototype.toString.call(held0));
}
