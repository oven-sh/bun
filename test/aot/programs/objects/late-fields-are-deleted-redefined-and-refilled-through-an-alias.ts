// Each function reads or stores a late field, changes the object through an untyped alias, and reads the field again.
class Leaf {
  weight: number;
  declare mark: number;
  declare owner: Leaf;
  constructor(weight: number) {
    this.weight = weight;
  }
}
class Crate {
  size: number;
  declare mark: number;
  declare owner: Crate;
  constructor(size: number) {
    this.size = size;
  }
}

function readDeleteRead(a: Leaf, alias: any): unknown {
  const first = a.owner;
  delete alias.owner;
  return [first === undefined, a.owner === undefined];
}
function storeDeleteRead(a: Leaf, alias: any, other: Leaf): unknown {
  a.owner = other;
  delete alias.owner;
  return a.owner === undefined;
}
function readRedefineRead(a: Leaf, alias: any): unknown {
  const first = a.mark;
  Object.defineProperty(alias, "mark", { get() { return -1; }, configurable: true });
  return [first, a.mark];
}
function storeMisfitRead(a: Leaf, alias: any): unknown {
  a.mark = 5;
  alias.mark = "text";
  return a.mark;
}
function readStoreUndefinedRead(a: Leaf, alias: any): unknown {
  const first = a.mark;
  alias.mark = undefined;
  return [first, a.mark, "mark" in a];
}
function readStoreRead(a: Leaf, b: Leaf): unknown {
  const first = a.mark;
  b.mark = first + 1;
  return [first, a.mark];
}
function otherFamily(a: any, b: any): unknown {
  const first = a.mark;
  b.mark = first + 1;
  return [first, a.mark];
}
function cloneOf(a: Leaf): Leaf {
  const copy = new Leaf(a.weight);
  copy.mark = a.mark;
  copy.owner = a.owner;
  copy.mark = a.mark + 1;
  return copy;
}
function cloneOrSelf(a: Leaf, takeSelf: boolean): unknown {
  const copy = new Leaf(a.weight);
  const chosen = takeSelf ? a : copy;
  const first = chosen.mark;
  copy.mark = 7;
  return [first, chosen.mark];
}
function fillIfEmpty(a: Leaf, other: Leaf): number {
  if (!a.owner) a.owner = other;
  return a.owner.weight;
}

function leaf(weight: number, filled: boolean): Leaf {
  const made = new Leaf(weight);
  if (filled) {
    made.mark = weight;
    made.owner = made;
  }
  return made;
}
function crate(size: number): Crate {
  const made = new Crate(size);
  made.mark = size;
  made.owner = made;
  return made;
}

const lines: string[] = [];
for (let round = 0; round < 400; round++) {
  const filled = (round & 3) !== 3;
  const results = [
    readDeleteRead(leaf(round, filled), leaf(round, true)),
    storeDeleteRead(leaf(round, filled), leaf(round, true), leaf(1, true)),
    readRedefineRead(leaf(round, filled), leaf(round, true)),
    storeMisfitRead(leaf(round, filled), leaf(round, true)),
    readStoreUndefinedRead(leaf(round, filled), leaf(round, true)),
    readStoreRead(leaf(round, filled), leaf(round, true)),
    otherFamily(leaf(round, filled), crate(round)),
    otherFamily(crate(round), leaf(round, filled)),
    cloneOf(leaf(round, filled)).mark,
    cloneOrSelf(leaf(round, filled), (round & 1) === 0),
    fillIfEmpty(leaf(round, filled), leaf(9, true)),
  ];
  if (round % 97 === 0) lines.push(JSON.stringify(results));
}
for (const filled of [true, false]) {
  let same = leaf(3, filled);
  lines.push(JSON.stringify(readDeleteRead(same, same)));
  same = leaf(3, filled);
  lines.push(JSON.stringify(storeDeleteRead(same, same, leaf(1, true))));
  same = leaf(3, filled);
  lines.push(JSON.stringify(readRedefineRead(same, same)));
  same = leaf(3, filled);
  lines.push(JSON.stringify(storeMisfitRead(same, same)));
  same = leaf(3, filled);
  lines.push(JSON.stringify(readStoreUndefinedRead(same, same)));
  same = leaf(3, filled);
  lines.push(JSON.stringify(readStoreRead(same, same)));
  same = leaf(3, filled);
  lines.push(JSON.stringify(otherFamily(same, same)));
}
console.log(lines.join("\n"));
