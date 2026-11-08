// answers: without-library
// # An object and a number are picked by one flag, and fields of both objects were read in front of the picks. What is read or written through the picked object is that object's, on either arm.
// # Here objects and numbers are variables of the module; the calls are written out.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 11 of 11 of 11
// # CHECK-NEXT: exited with 0
class Node { constructor(key, weight, child) { this.key = key; this.weight = weight; this.child = child; } get() { return this.key * 2; } }
function tree(kind) { const made = { left: new Node(1, 2, new Node(10, 1, null)), right: new Node(5, 3, new Node(50, 1, null)) }; if (kind === 1) made.right.weight = 0; if (kind === 2) made.left.child = null; if (kind === 3) made.left.weight = 0; if (kind === 4) made.right.child = null; return made; }
const both = tree(0);
const a = both.left, b = both.right;
let x = 5, y = 6;
function pick(sel) { if (!x || !y || !a.child || !b.child) return -2; const c = (sel & 1) !== 0 ? (sel & 2) !== 0 : (sel & 4) !== 0; const v = c ? a : b, w = c ? x : y; if (w && v.child) { v.child.key += 100; return a.child.key * 1000 + b.child.key; } return -1; }
report(pick(0));
report(pick(1));
report(pick(2));
report(pick(3));
report(pick(4));
report(pick(5));
report(pick(6));
report(pick(7));
x = 0;
report(pick(0));
report(pick(7));
report("end");
