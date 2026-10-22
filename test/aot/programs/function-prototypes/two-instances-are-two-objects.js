// Two constructions at one place make two objects: they are not equal, and a store into one is not seen in the other.
function Meter() {}
function make() { return new Meter(); }
const a = make(), b = make();
a.size = 1;
console.log(a === b, a == b, Object.is(a, b), b.size, new Set([a, b, a]).size, Object.getPrototypeOf(a) === Object.getPrototypeOf(b));
