// A function that is constructed gets another object stored as its `prototype` between two `instanceof` tests: what was made before is no instance any more.
function V(x) { this.x = x; }
function isV(o) { return o instanceof V; }

function deed(other) {
  V.prototype = other;
}
const early = new V(1);
console.log(String(isV(early)), String(isV({})));
let count = 0;
for (let i = 0; i < 200; i++) count += isV(i & 1 ? early : new V(i)) ? 1 : 0;
console.log(String(count));
const first = V.prototype;
deed({ late: true });
const late = new V(2);
console.log(String(isV(early)), String(isV(late)), String(late.late), String(isV(Object.create(first))), String(isV(Object.create(V.prototype))));
count = 0;
for (let i = 0; i < 200; i++) count += isV(i % 3 ? early : new V(i)) ? 1 : 0;
console.log(String(count));
deed(first);
console.log(String(isV(early)), String(isV(late)), String(isV(new V(3))));
