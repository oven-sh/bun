// A bound function of a constructor stands on the right of `instanceof`: it has no `prototype` of its own, and the test goes on to the function that it is bound to.
function V(x) { this.x = x; }
class Leaf { constructor() { this.a = 1; } }
function isOf(o, C) { return o instanceof C; }

function deed(C) {
  return C.bind(null);
}
const BoundV = deed(V), BoundLeaf = deed(Leaf), Twice = deed(BoundV);
console.log(String(isOf(new V(1), BoundV)), String(isOf(new BoundV(2), V)), String(isOf(new Leaf(), BoundLeaf)), String(isOf(new V(1), BoundLeaf)), String(isOf(new V(1), Twice)), String("prototype" in BoundV));
let count = 0;
for (let i = 0; i < 200; i++) count += isOf(i & 1 ? new V(i) : new Leaf(), i & 2 ? BoundV : V) ? 1 : 0;
console.log(String(count));
V.prototype = {};
console.log(String(isOf(new V(1), BoundV)), String(isOf(new BoundV(1), Twice)));
BoundV.prototype = Leaf.prototype;
console.log(String(isOf(new Leaf(), BoundV)), String(isOf(new V(1), BoundV)));
