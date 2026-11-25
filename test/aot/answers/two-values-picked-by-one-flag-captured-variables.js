// answers: without-library
// # An object and a number are picked by one flag, and fields of both objects were read in front of the picks. What is read or written through the picked object is that object's, on either arm.
// # Here objects and numbers are captured variables; the calls are written out.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 9 of 9 of 9
// # CHECK-NEXT: exited with 0
class Node { constructor(key, weight, child) { this.key = key; this.weight = weight; this.child = child; } get() { return this.key * 2; } }
function tree(kind) { const made = { left: new Node(1, 2, new Node(10, 1, null)), right: new Node(5, 3, new Node(50, 1, null)) }; if (kind === 1) made.right.weight = 0; if (kind === 2) made.left.child = null; if (kind === 3) made.left.weight = 0; if (kind === 4) made.right.child = null; return made; }
function maker(both) { const a = both.left, b = both.right; let x = 5, y = 6; return function pick(sel) { if (!x || !y || !a.child || !b.child) return -2; const c = (sel & 1) !== 0 ? (sel & 2) !== 0 : (sel & 4) !== 0; const v = c ? a : b, w = c ? x : y; x++; if (w && v.child) return v.child.key * 100 + w; return -1; }; }
const picks = maker(tree(0));
report(picks(0));
report(picks(1));
report(picks(2));
report(picks(3));
report(picks(4));
report(picks(5));
report(picks(6));
report(picks(7));
report("end");
