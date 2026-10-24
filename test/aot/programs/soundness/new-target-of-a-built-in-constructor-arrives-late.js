// new.target of a built-in constructor arrives late: first a subclass, then the built-in itself, then another subclass.
function main() {
class Keyed extends Map { tag() { return "keyed"; } }
class Other extends Map { tag() { return 2; } }
let target = Keyed;
const order = [];
function step(made) {
  order.push(made instanceof Keyed ? made.tag() : made instanceof Other ? made.tag() + 1 : typeof made.tag);
  target = target === Keyed ? Map : Other;
}
for (let i = 0; i < 3; i++) {
  const made = Reflect.construct(Map, [[[1, { v: i }]]], target);
  step(made);
  console.log(made.get(1).v, made.size);
}
console.log(order.join());

class Rows extends Array { first() { return this[0]; } }
class Columns extends Array { first() { return "column " + this[0]; } }
function make(C, x) { return new C(x, x); }
let made = make(Rows, 1);
console.log(made.first(), made.length);
function again() { made = make(Columns, "c"); }
[1].forEach(again);
console.log(made.first(), made.length);
}
main();
