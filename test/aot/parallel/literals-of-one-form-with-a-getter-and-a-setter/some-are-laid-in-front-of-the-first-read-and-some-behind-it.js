// Literals of one form share a layout: the accessors of all of them wait at one field until it is asked. Two are laid in front of the first read, two behind it, one behind the first store.
const seen = [];
const a = { get g() { return 1; }, set g(v) { seen.push("a" + v); } };
const b = { get g() { return 2; }, set g(v) { seen.push("b" + v); } };
let t = a.g;
const c = { get g() { return 30; }, set g(v) { seen.push("c" + v); } };
const d = { get g() { return 400; }, set g(v) { seen.push("d" + v); } };
t += b.g + c.g + d.g;
a.g = 1;
d.g = 4;
const e = { get g() { return 5000; }, set g(v) { seen.push("e" + v); } };
e.g = 5;
b.g = 2;
t += e.g;
console.log(t, seen.join());
