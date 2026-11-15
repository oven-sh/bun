// == between fields that hold nodes and null, nodes and undefined, or all three, in the loops of trees.
function Node(key, parent) { this.key = key; this.left = null; this.right = null; this.parent = parent; this.next = undefined; }
const root = new Node(0, null), all = [root];
for (let i = 1; i < 31; i++) { const parent = all[(i - 1) >> 1], node = new Node(i, parent); if (i & 1) parent.left = node; else parent.right = node; all.push(node); }
function min(x) { while (x.left) x = x.left; return x; }
function successor(x) { if (x.right) return min(x.right); let y = x.parent; while (y && x == y.right) { x = y; y = y.parent; } return y; }
function lefts(x) { let n = 0; while (x != root && x.parent) { if (x == x.parent.left) n++; x = x.parent; } return n; }
function sameLeft(a, b) { return a.left == b.left; }
function sameNext(a, b) { return a.next == b.next; }
function leftIsNext(a, b) { return a.left == b.next; }
function nextIsParent(a) { return a.next == a.parent; }
let keys = "", at = min(root); while (at) { keys += at.key + " "; at = successor(at); }
console.log(keys, all.map(lefts).join(""));
function table() { let t = ""; for (const a of all) { for (const b of all) t += (sameLeft(a, b) ? 1 : 0) + (sameNext(a, b) ? 2 : 0) + (leftIsNext(a, b) ? 4 : 0); t += nextIsParent(a) ? "p " : "- "; } return t; }
console.log(table());
all[3].next = null; all[4].next = all[1]; all[5].next = all[5].parent; all[30].left = all[1]; all[29].left = all[2];
console.log(table());
all[6].parent = undefined; all[7].left = undefined; console.log(table(), nextIsParent(all[6]), leftIsNext(all[7], all[8]), leftIsNext(all[9], all[7]), all[7].left == all[9].left, all[7].left != all[10].next, all[7].left == 0, all[7].left == "");
