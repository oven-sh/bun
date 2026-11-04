// One `function` in the body of another is evaluated several times: each function object has a `prototype` of its own, and what the one makes is no instance of the other.
function make() {
  function Made(x) { this.x = x; }
  Made.is = function (o) { return o instanceof Made; };
  return Made;
}

function deed() {
  return make();
}
const First = deed();
const first = new First(1);
console.log(String(First.is(first)), String(First.is({})));
let count = 0;
for (let i = 0; i < 200; i++) count += First.is(i & 1 ? first : new First(i)) ? 1 : 0;
console.log(String(count));
const Second = deed();
const second = new Second(2);
console.log(String(First.is(second)), String(Second.is(first)), String(Second.is(second)), String(First.is(first)), String(first instanceof Second), String(second instanceof Second));
count = 0;
for (let i = 0; i < 200; i++) count += (i & 1 ? First : Second).is(i & 2 ? first : second) ? 1 : 0;
console.log(String(count));
