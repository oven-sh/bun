// STATISTIC: AccessesUnknown <= 60
class Node4 { constructor(kind, flags) { this.kind = kind; this.flags = flags; this.parent = undefined; } depth() { let depth = 0; for (let node = this; node; node = node.parent) depth += node.flags; return depth; } }
class Leaf extends Node4 { constructor(kind) { super(kind, 2); this.leaf = true; } }
function create(kind, parent) { const node = kind & 1 ? new Leaf(kind) : new Node4(kind, 1); node.parent = parent; return node; }
function run(count) { let sum = 0; for (let i = 0; i < count; i++) { let node; for (let k = 0; k < 8; k++) node = create(k & 3, node); sum += node.depth() + node.kind; } return sum; }
console.log(run(100), new Node4(1, 2).debugKind, "debugKind" in new Leaf(1));
Object.defineProperty(Node4.prototype, "debugKind", { get() { return "kind " + this.kind; }, configurable: true });
Object.defineProperties(Node4.prototype, { debugDepth: { get() { return this.depth(); } } });
console.log(run(100), new Node4(1, 2).debugKind, new Leaf(3).debugKind, new Leaf(3).debugDepth, Object.keys(new Leaf(1)).join());
let sum = 0;
for (let i = 0; i < 50; i++) sum += create(i & 3, create(i & 1)).debugDepth;
console.log(sum);
