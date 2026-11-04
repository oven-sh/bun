// The class above the class on the right of `instanceof` gets a Symbol.hasInstance, which the class below inherits.
class Root { }
class Leaf extends Root { constructor() { super(); this.a = 1; } }
function isLeaf(x) { return x instanceof Leaf; }

let asked = 0;
function deed() {
  Object.defineProperty(Root, Symbol.hasInstance, { value(x) { asked++; return this === Leaf && x === 7; }, configurable: true });
}
const leaf = new Leaf();
console.log(String(isLeaf(leaf)), String(isLeaf(7)), String(isLeaf({})));
let count = 0;
for (let i = 0; i < 200; i++) count += isLeaf(i & 1 ? leaf : 7) ? 1 : 0;
console.log(String(count), String(asked));
deed();
console.log(String(isLeaf(leaf)), String(isLeaf(7)), String(isLeaf({})), String(asked));
count = 0;
for (let i = 0; i < 200; i++) count += isLeaf(i % 4 ? leaf : 7) ? 1 : 0;
console.log(String(count), String(asked));
