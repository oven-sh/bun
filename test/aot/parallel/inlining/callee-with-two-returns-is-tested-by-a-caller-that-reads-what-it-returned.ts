// a small function returns the constant true on one way and what it has read on the other, and its caller tests the answer and then reads it again on both sides
type Tree = { kids?: unknown; empty?: unknown };
function isLeaf(n: Tree) { if (n.kids) return n.empty; return true; }
function subject(n: Tree) { const leaf = isLeaf(n); if (leaf) return "leaf:" + String(leaf); return "inner:" + String(leaf); }
function deed(n: Tree) { return subject(n); }
console.log(deed({}), deed({ kids: 1 }), deed({ kids: 1, empty: "e" }), deed({ kids: 0, empty: 0 }), deed({ kids: [], empty: NaN }));
const trees: Tree[] = [{}, { kids: 1 }, { kids: 1, empty: 1 }, { kids: "", empty: 2 }, { kids: {}, empty: -0 }];
let lengths = 0;
for (let i = 0; i < 300; i++) lengths += subject(trees[i % trees.length]).length;
console.log(String(lengths));
let reads = 0;
console.log(deed({ get kids() { reads++; return reads; }, get empty() { reads += 10; return null; } }), String(reads));
