// A typed function does the damage and then reads a field through a reference that its type calls an object and that is null. The TypeError comes out of an activation whose return address has been swapped, and the holder's handler has to be found.
class Leaf {
  value: number;
  constructor(value: number) {
    this.value = value;
  }
}
class Branch {
  leaf: Leaf;
  weight: number;
  constructor(leaf: Leaf, weight: number) {
    this.leaf = leaf;
    this.weight = weight;
  }
}

let strikes = false;
const nothing: any = null;
function reads(branch: Branch, other: Branch): number {
  if (strikes) {
    delete (other as any).weight;
    branch.leaf = nothing;
  }
  return branch.leaf.value + branch.weight;
}
function between(branch: Branch, other: Branch): number {
  return reads(branch, other) + other.weight;
}

function holder(branch: Branch, other: Branch): string {
  const before = other.weight;
  let got: string;
  try {
    got = "" + between(branch, other);
  } catch (error) {
    got = (error as Error).name;
  }
  return before + " " + got + " " + other.weight + " " + (branch.leaf === null);
}

for (let round = 0; round < 300; round++) {
  strikes = round % 100 === 99;
  const line = holder(new Branch(new Leaf(round), 1), new Branch(new Leaf(0), 2));
  if (strikes || round === 0) console.log(round + ": " + line);
}
