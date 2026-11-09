// answers: without-library
// # An object and a number are picked by one flag, and fields of both objects were read in front of the picks. What is read or written through the picked object is that object's, on either arm.
// # Here three objects, picked by two switches on one number; the calls are written out.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 19 of 19 of 19
// # CHECK-NEXT: exited with 0
class Node { constructor(key, weight, child) { this.key = key; this.weight = weight; this.child = child; } get() { return this.key * 2; } }
function tree(kind) { const made = { left: new Node(1, 2, new Node(10, 1, null)), right: new Node(5, 3, new Node(50, 1, null)) }; if (kind === 1) made.right.weight = 0; if (kind === 2) made.left.child = null; if (kind === 3) made.left.weight = 0; if (kind === 4) made.right.child = null; return made; }
function pick(tree, key, exact) { const left = tree.left, right = tree.right, third = tree.third; if (!left.weight || !right.weight || !third.weight || !left.child || !right.child || !third.child) return "none"; const which = exact ? (key === left.key ? 0 : 1) : key < right.key ? 1 : 2; let side, weight; switch (which) { case 0: side = left; break; case 1: side = right; break; default: side = third; } switch (which) { case 0: weight = left.weight; break; case 1: weight = right.weight; break; default: weight = third.weight; } if (weight && side.child) return side.child.key; return "leaf"; }
function three(kind) { const made = tree(kind); made.third = new Node(7, 4, new Node(70, 1, null)); return made; }
report(pick(three(0), 1, false));
report(pick(three(0), 1, true));
report(pick(three(0), 3, false));
report(pick(three(0), 3, true));
report(pick(three(0), 9, false));
report(pick(three(0), 9, true));
report(pick(three(1), 1, false));
report(pick(three(1), 1, true));
report(pick(three(1), 3, false));
report(pick(three(1), 3, true));
report(pick(three(1), 9, false));
report(pick(three(1), 9, true));
report(pick(three(2), 1, false));
report(pick(three(2), 1, true));
report(pick(three(2), 3, false));
report(pick(three(2), 3, true));
report(pick(three(2), 9, false));
report(pick(three(2), 9, true));
report("end");
