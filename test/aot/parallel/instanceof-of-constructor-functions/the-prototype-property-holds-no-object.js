// A function that is constructed gets a number stored as its `prototype`: `instanceof` throws for an object on the left, and answers false for a primitive without a look at the property.
function V(x) { this.x = x; }
function isV(o) { return o instanceof V; }

function deed(value) {
  V.prototype = value;
}
function attempt(o) { try { return String(isV(o)); } catch (error) { return error.name; } }
const early = new V(1);
console.log(attempt(early), attempt({}), attempt(5));
let count = 0;
for (let i = 0; i < 200; i++) count += isV(i & 1 ? early : i) ? 1 : 0;
console.log(String(count));
deed(5);
console.log(attempt(early), attempt({}), attempt(5), attempt(null), attempt(new V(2)), String(Object.getPrototypeOf(new V(3)) === Object.prototype));
deed(undefined);
console.log(attempt(early), attempt("text"));
deed(null);
console.log(attempt(early), attempt(undefined));
