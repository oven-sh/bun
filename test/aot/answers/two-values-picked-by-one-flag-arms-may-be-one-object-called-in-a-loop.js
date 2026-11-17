// answers: without-library
// # An object and a number are picked by one flag, and fields of both objects were read in front of the picks. What is read or written through the picked object is that object's, on either arm.
// # Here the two objects may be one; the function is called out of a loop, where it is copied.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 17 of 17 of 17
// # CHECK-NEXT: exited with 0
class Node { constructor(key, weight, child) { this.key = key; this.weight = weight; this.child = child; } get() { return this.key * 2; } }
function tree(kind) { const made = { left: new Node(1, 2, new Node(10, 1, null)), right: new Node(5, 3, new Node(50, 1, null)) }; if (kind === 1) made.right.weight = 0; if (kind === 2) made.left.child = null; if (kind === 3) made.left.weight = 0; if (kind === 4) made.right.child = null; return made; }
function pick(left, right, key, exact) { if (!left.weight || !right.weight || !left.child || !right.child) return "none"; const flag = exact ? key === left.key : key < right.key; const side = flag ? left : right; const weight = flag ? left.weight : right.weight; side.weight = 9; if (weight && side.child) return left.weight * 10 + right.weight; return "leaf"; }
for (let i = 0; i < 16; i++) { const made = tree(0); report(pick(made.left, (i & 8) !== 0 ? made.left : made.right, i >> 1, (i & 1) !== 0)); }
report("end");
