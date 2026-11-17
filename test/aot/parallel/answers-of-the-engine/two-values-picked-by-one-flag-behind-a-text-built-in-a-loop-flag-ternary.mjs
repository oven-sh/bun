// An object and a number are picked by one flag, and fields of both objects were read in front of the picks. What is read or written through the picked object is that object's, on either arm.
// Here the flag comes out of a ternary of two comparisons; the number is tested, then a field of the object is tested and read; the calls are written out.
// A text is built in a loop in front of it all: so the walk knows what is live in the body, and may walk a join once for each way that enters it.
// Under: --aot-testing=ForceStraightCompilation: the closed ways give the same answers
globalThis.report = value => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
class Node { constructor(key, weight, child) { this.key = key; this.weight = weight; this.child = child; } get() { return this.key * 2; } }
function tree(kind) { const made = { left: new Node(1, 2, new Node(10, 1, null)), right: new Node(5, 3, new Node(50, 1, null)) }; if (kind === 1) made.right.weight = 0; if (kind === 2) made.left.child = null; if (kind === 3) made.left.weight = 0; if (kind === 4) made.right.child = null; return made; }
function pick(tree, key, exact) { const left = tree.left, right = tree.right; let label = ""; for (let turnOfLabel = 0; turnOfLabel < 2; turnOfLabel++) label += "x"; if (label.length !== 2) return "never"; if (!left.weight || !right.weight || !left.child || !right.child) return "none"; const flag = exact ? key === left.key : key < right.key; const side = flag ? left : right; const weight = flag ? left.weight : right.weight; if (weight && side.child) return side.child.key; return "leaf"; }
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
