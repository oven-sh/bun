// An object that lies in a typed field of another object was damaged long ago. A typed function reads it out of the field, reads its fields in place and passes it to another typed function.
class Leaf {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
}
class Branch {
  leaf: Leaf;
  constructor(leaf: Leaf) {
    this.leaf = leaf;
  }
}

function twice(leaf: Leaf): string {
  return "" + leaf.value * 2;
}

function visit(branch: Branch): string {
  const leaf = branch.leaf;
  return leaf.value + " " + twice(leaf) + " " + branch.leaf.value;
}

const branches: Branch[] = [];
for (let index = 0; index < 8; index++) branches.push(new Branch(new Leaf(index)));
delete (branches[1].leaf as any).value;
Object.defineProperty(branches[3].leaf, "value", { get: () => -7 });
(branches[5].leaf as any).value = "text";
Object.freeze(branches[7].leaf);

let text = "";
for (let round = 0; round < 200; round++) {
  text = "";
  for (const branch of branches) text += visit(branch) + " | ";
}
console.log(text);
