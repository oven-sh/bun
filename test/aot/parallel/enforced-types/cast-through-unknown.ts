// `value as unknown as Leaf`: the checker believes it, and the store brings a list where a class is written. The slot is held to the class: the field leaves its slot in that object, and every read answers as plain Bun does.
// Under: --aot-testing=CheckProofsAtRunTime: the type that a slot is held to
class Leaf {
  weight: number;
  constructor(weight: number) {
    this.weight = weight;
  }
}
class Branch {
  leaf: Leaf;
  constructor(leaf: Leaf) {
    this.leaf = leaf;
  }
}
function weightOf(branch: Branch): string {
  return String(branch.leaf.weight) + " " + (branch.leaf instanceof Leaf) + " " + Array.isArray(branch.leaf);
}
function graft(branch: Branch, value: unknown) {
  branch.leaf = value as unknown as Leaf;
}
const stranger: unknown = JSON.parse("[1, 2, 3]");
const straight = new Branch(new Leaf(1));
console.log("before", weightOf(straight));
graft(straight, stranger);
console.log("behind", weightOf(straight));
graft(straight, new Leaf(2));
console.log("honest again", weightOf(straight));
for (let turn = 0; turn < 3; turn++) {
  const branch = new Branch(new Leaf(turn));
  const before = weightOf(branch);
  if (turn === 1) graft(branch, stranger);
  console.log(turn, before, "|", weightOf(branch));
}
