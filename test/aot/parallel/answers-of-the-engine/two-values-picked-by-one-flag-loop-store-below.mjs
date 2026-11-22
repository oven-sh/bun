// An object and a number are picked by one flag, and fields of both objects were read in front of the picks. What is read or written through the picked object is that object's, on either arm.
// Here the flag comes out of a ternary of two comparisons; a store goes through a field of the object; in a loop; the calls are written out.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
class Node { constructor(key, weight, child) { this.key = key; this.weight = weight; this.child = child; } get() { return this.key * 2; } }
function tree(kind) { const made = { left: new Node(1, 2, new Node(10, 1, null)), right: new Node(5, 3, new Node(50, 1, null)) }; if (kind === 1) made.right.weight = 0; if (kind === 2) made.left.child = null; if (kind === 3) made.left.weight = 0; if (kind === 4) made.right.child = null; return made; }
function pick(tree, key, exact) { const left = tree.left, right = tree.right; if (!left.weight || !right.weight || !left.child || !right.child) return "none"; let total = 0; for (let turn = 0; turn < 4; turn++) { const flag = exact ? (key + turn) === left.key : (key + turn) < right.key; const side = flag ? left : right; const weight = flag ? left.weight : right.weight; if (weight && side.child) { side.child.key = 100; { total += (left.child === null ? 7 : left.child.key) * 1000 + (right.child === null ? 7 : right.child.key); continue; } } total -= 1; } return total; }
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
report(pick(tree(3), 1, false));
report(pick(tree(3), 1, true));
report(pick(tree(3), 3, false));
report(pick(tree(3), 3, true));
report(pick(tree(3), 9, false));
report(pick(tree(3), 9, true));
report(pick(tree(4), 1, false));
report(pick(tree(4), 1, true));
report(pick(tree(4), 3, false));
report(pick(tree(4), 3, true));
report(pick(tree(4), 9, false));
report(pick(tree(4), 9, true));
report("end");
