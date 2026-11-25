// answers: without-library
// # An object and a number are picked by one flag, and fields of both objects were read in front of the picks. What is read or written through the picked object is that object's, on either arm.
// # Here a recursive walk down a tree; the function is called out of a loop, where it is copied.
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 23 of 23 of 23
// # CHECK-NEXT: exited with 0
class Node { constructor(key, weight, left, right) { this.key = key; this.weight = weight; this.left = left; this.right = right; } }
function walk(node, key, exact) { const left = node.left, right = node.right; if (!left || !right) return node.key; if (!left.weight || !right.weight || !left.left || !right.left) return node.key; const goLeft = exact ? key === left.key : key < right.key; const side = goLeft ? left : right; const weight = goLeft ? left.weight : right.weight; if (weight && side.left) return walk(side.left, key, exact) + side.left.key; return -1; }
function leaf(k) { return new Node(k, 1, null, null); }
function mid(k) { return new Node(k, 2, leaf(k * 10), leaf(k * 10 + 1)); }
const root = new Node(0, 1, new Node(1, 2, mid(2), mid(3)), new Node(5, 3, mid(6), mid(7)));
for (let i = 0; i < 22; i++) report(walk(root, i >> 1, (i & 1) !== 0));
report("end");
