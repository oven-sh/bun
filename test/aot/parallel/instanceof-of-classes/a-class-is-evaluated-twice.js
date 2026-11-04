// One `class` is evaluated twice: each evaluation has a class object and a prototype object of its own, and the instances of the one are none of the other.
function define() {
  class Leaf { constructor() { this.a = 1; } static is(x) { return x instanceof Leaf; } }
  return Leaf;
}
function isOf(x, C) { return x instanceof C; }

function deed() {
  return define();
}
const First = deed();
const first = new First();
console.log(String(First.is(first)), String(isOf(first, First)));
let count = 0;
for (let i = 0; i < 200; i++) count += First.is(i & 1 ? first : {}) ? 1 : 0;
console.log(String(count));
const Second = deed();
const second = new Second();
console.log(String(First.is(second)), String(Second.is(first)), String(Second.is(second)), String(First.is(first)), String(isOf(first, Second)), String(isOf(second, Second)), String(First === Second));
count = 0;
for (let i = 0; i < 200; i++) count += (i & 1 ? First : Second).is(i & 2 ? first : second) ? 1 : 0;
console.log(String(count));
