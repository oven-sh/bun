// A class gets a Symbol.hasInstance of its own, by a definition, between two `instanceof` tests against it.
class Leaf { constructor() { this.a = 1; } }
class Stone { constructor() { this.c = 3; } }
function isLeaf(x) { return x instanceof Leaf; }

function deed() {
  Object.defineProperty(Leaf, Symbol.hasInstance, { value(x) { return x instanceof Stone; }, configurable: true });
}
const leaf = new Leaf(), stone = new Stone();
console.log(String(isLeaf(leaf)), String(isLeaf(stone)), String(isLeaf(5)));
let count = 0;
for (let i = 0; i < 200; i++) count += isLeaf(i & 1 ? leaf : stone) ? 1 : 0;
console.log(String(count));
deed();
console.log(String(isLeaf(leaf)), String(isLeaf(stone)), String(isLeaf(5)), String(leaf instanceof Leaf), String(stone instanceof Leaf));
count = 0;
for (let i = 0; i < 200; i++) count += isLeaf(i % 3 ? leaf : stone) ? 1 : 0;
console.log(String(count));
delete Leaf[Symbol.hasInstance];
console.log(String(isLeaf(leaf)), String(isLeaf(stone)));
