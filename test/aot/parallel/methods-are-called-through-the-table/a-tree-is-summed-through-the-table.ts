// STATISTIC: MethodCallsThroughTable >= 1
interface Knot { sum(): number; depth(): number }
class Leaf implements Knot { constructor(readonly worth: number) {} sum() { return this.worth; } depth() { return 1; } }
class Fork implements Knot { constructor(readonly left: Knot, readonly right: Knot) {} sum() { return this.left.sum() + this.right.sum(); } depth() { return 1 + Math.max(this.left.depth(), this.right.depth()); } }
class Stem implements Knot { constructor(readonly next: Knot) {} sum() { return 1 + this.next.sum(); } depth() { return 1 + this.next.depth(); } }
function grow(levels: number, seed: number): Knot {
  if (!levels) return new Leaf(seed);
  return seed % 3 ? new Fork(grow(levels - 1, seed + 1), grow(levels - 1, seed + 2)) : new Stem(grow(levels - 1, seed + 1));
}
const tree = grow(10, 1);
console.log(tree.sum(), tree.depth());
let chain: Knot = new Leaf(0);
for (let link = 0; link < 3000000; link++) chain = new Stem(chain);
try { console.log(chain.sum()); } catch (error) { console.log((error as Error).constructor.name); }
