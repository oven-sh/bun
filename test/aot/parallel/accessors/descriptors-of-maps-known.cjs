// STATISTIC: AccessesUnknown <= 60
// Object.defineProperties() with accessors on objects that stay in sight.
class Node4 { constructor(kind, flags) { this.kind = kind; this.flags = flags; this.parent = undefined; } depth() { let depth = 0; for (let node = this; node; node = node.parent) depth += node.flags; return depth; } }
let reads = 0;
const library = {};
Object.defineProperties(library, {
  Node4: { enumerable: true, get: () => Node4 },
  create: { value: (kind, parent) => { const node = new Node4(kind, 1); node.parent = parent; return node; }, enumerable: true },
  counted: { get() { reads++; return this.create(reads).kind; }, configurable: true },
  stored: { get: () => stored, set: (value) => { stored = value; } },
});
let stored = new Node4(5, 5);
function run(count) { let sum = 0; for (let i = 0; i < count; i++) { let node; for (let k = 0; k < 8; k++) node = library.create(k & 3, node); sum += node.depth() + new library.Node4(i, 2).flags; } return sum; }
console.log(run(100), library.counted, library.counted, library.stored.depth());
library.stored = new Node4(6, 7);
console.log(library.stored.flags, stored.kind, reads, Object.keys(library).join());
