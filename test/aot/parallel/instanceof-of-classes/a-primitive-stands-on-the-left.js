// Primitives of every kind stand on the left of `instanceof` against a class of the program, and so do the wrappers of some, one of which is laid below the prototype object of the class.
class Leaf { constructor() { this.a = 1; } }
function isLeaf(x) { return x instanceof Leaf; }

function deed(value) {
  const wrapper = Object(value);
  Object.setPrototypeOf(wrapper, Leaf.prototype);
  return wrapper;
}
const values = [0, -0, 1.5, NaN, "", "text", true, false, null, undefined, Symbol("s"), 10n];
let said = "";
for (const value of values) said += isLeaf(value) ? "1" : "0";
console.log(said);
let count = 0;
for (let i = 0; i < 240; i++) count += isLeaf(i % 13 ? values[i % 12] : new Leaf()) ? 1 : 0;
console.log(String(count));
console.log(String(isLeaf(5)), String(isLeaf(new Number(5))), String(isLeaf(deed(5))), String(isLeaf(deed("text"))), String(isLeaf(deed(5).valueOf())), String(isLeaf("text")));
