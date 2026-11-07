// answers: without-library
// # An object and a number are picked by one flag, and fields of both objects were read in front of the picks. What is read or written through the picked object is that object's, on either arm.
// # Here the two objects are of classes that lay their fields out in different orders; the calls are written out.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 19 of 19 of 19
// # CHECK-NEXT: exited with 0
class Left { constructor(key, weight, child) { this.key = key; this.weight = weight; this.child = child; } }
class Right { constructor(key, weight, child) { this.child = child; this.weight = weight; this.key = key; } }
function tree(kind) { const made = { left: new Left(1, 2, new Left(10, 1, null)), right: new Right(5, 3, new Right(50, 1, null)) }; if (kind === 1) made.right.weight = 0; if (kind === 2) made.left.child = null; return made; }
function pick(tree, key, exact) { const left = tree.left, right = tree.right; if (!left.weight || !right.weight || !left.child || !right.child) return "none"; const flag = exact ? key === left.key : key < right.key; const side = flag ? left : right; const weight = flag ? left.weight : right.weight; if (weight && side.child) return side.child.key; return "leaf"; }
report(pick(tree(0), 1, false));
report(pick(tree(0), 1, true));
report(pick(tree(0), 3, false));
report(pick(tree(0), 3, true));
report(pick(tree(0), 9, false));
report(pick(tree(0), 9, true));
report(pick(tree(1), 1, false));
report(pick(tree(1), 1, true));
report(pick(tree(1), 3, false));
report(pick(tree(1), 3, true));
report(pick(tree(1), 9, false));
report(pick(tree(1), 9, true));
report(pick(tree(2), 1, false));
report(pick(tree(2), 1, true));
report(pick(tree(2), 3, false));
report(pick(tree(2), 3, true));
report(pick(tree(2), 9, false));
report(pick(tree(2), 9, true));
report("end");
