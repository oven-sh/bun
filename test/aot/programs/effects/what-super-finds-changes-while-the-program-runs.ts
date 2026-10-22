// A getter takes the place of the method that `super.hit` finds, then another object the place of the class above.
let seen = 0;
class Root { hit(): number { return 1 } }
class Leaf extends Root { hit(): number { return super.hit() + 10 } }
function callHit(leaf: Leaf): number { const before = seen; const result = leaf.hit(); return result * 100 + (seen - before) }

const leaf = new Leaf();
console.log(callHit(leaf));
Object.defineProperty(Root.prototype, "hit", { get() { seen++; return () => 5 }, configurable: true });
console.log(callHit(leaf));
Object.setPrototypeOf(Leaf.prototype, { hit() { seen += 2; return 7 } });
console.log(callHit(leaf), seen);
