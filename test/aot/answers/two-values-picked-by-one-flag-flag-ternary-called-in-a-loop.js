// answers: without-library
// # An object and a number are picked by one flag, and fields of both objects were read in front of the picks. What is read or written through the picked object is that object's, on either arm.
// # Here the flag comes out of a ternary of two comparisons; the number is tested, then a field of the object is tested and read; the function is called out of a loop, where it is copied.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 81 of 81 of 81
// # CHECK-NEXT: exited with 0
class Node { constructor(key, weight, child) { this.key = key; this.weight = weight; this.child = child; } get() { return this.key * 2; } }
function tree(kind) { const made = { left: new Node(1, 2, new Node(10, 1, null)), right: new Node(5, 3, new Node(50, 1, null)) }; if (kind === 1) made.right.weight = 0; if (kind === 2) made.left.child = null; if (kind === 3) made.left.weight = 0; if (kind === 4) made.right.child = null; return made; }
function pick(tree, key, exact) { const left = tree.left, right = tree.right; if (!left.weight || !right.weight || !left.child || !right.child) return "none"; const flag = exact ? key === left.key : key < right.key; const side = flag ? left : right; const weight = flag ? left.weight : right.weight; if (weight && side.child) return side.child.key; return "leaf"; }
for (let kind = 0; kind < 5; kind++) { for (let i = 0; i < 16; i++) report(pick(tree(kind), i >> 1, (i & 1) !== 0)); }
report("end");
