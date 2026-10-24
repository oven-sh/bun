// Two unrelated families that share the name of a field that is stored late.
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

// 1 | 3: a store under the name into the other family stands between two reads.
function twoFamilies(a: Leaf, b: Crate): number {
  const first = a.mark;
  b.mark = first + 1;
  return first + a.mark;
}
function twoFamiliesOfReferences(a: Leaf, b: Crate, c: Crate): number {
  const first = a.owner;
  b.owner = c;
  return first.weight + a.owner.weight;
}
// the same out of fields of a holder
class Holder {
  leaf: Leaf;
  crate: Crate;
  constructor(leaf: Leaf, crate: Crate) {
    this.leaf = leaf;
    this.crate = crate;
  }
}
function outOfHolder(h: Holder): number {
  const a = h.leaf;
  const b = h.crate;
  const first = a.mark;
  b.mark = first + 1;
  return first + a.mark;
}
// untyped
function untypedTwoFamilies(a: any, b: any): number {
  const first = a.mark;
  b.mark = first + 1;
  return first + a.mark;
}

// 2: a store that can only fill the slot
function countUp(a: Leaf, turns: number): number {
  for (let i = 0; i < turns; i++) a.mark = a.mark + 1;
  return a.mark;
}
function fillIfEmpty(a: Leaf, other: Leaf): number {
  if (!a.owner) a.owner = other;
  return a.owner.weight;
}
function storeThenRead(a: Leaf, other: Leaf): number {
  a.owner = other;
  return a.owner.weight;
}

// 4: a fresh array that is returned
function weights(xs: Leaf[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < xs.length; i++) out.push(xs[i].weight);
  return out;
}
function weightsCounted(xs: Leaf[]): number {
  const out: number[] = [];
  for (let i = 0; i < xs.length; i++) out.push(xs[i].weight);
  return out.length;
}
function copyOf(a: Leaf): { mark: number; twice: number } {
  const o = { mark: 0, twice: 0 };
  o.mark = a.mark;
  o.twice = a.mark * 2;
  return o;
}

// 6: a field of birth and an optional late field
class Item {
  kind: number;
  declare label: string | undefined;
  constructor(kind: number) {
    this.kind = kind;
  }
}
function kindAndLabel(n: Item): number {
  return n.kind + (n.label ? 1 : 0);
}


// Anything may happen to an object that untyped code holds: nothing of it happens to the objects of the families at run time.
function disturb(o: any, name: string, how: number): void {
  if (how === 1) delete o[name];
  else if (how === 2) Object.defineProperty(o, name, { get() { return 1; }, configurable: true });
  else if (how === 3) o[name] = how;
  else if (how === 4) Object.setPrototypeOf(o, null);
  else if (how === 5) Object.freeze(o);
}

const pool: any[] = [];
for (let i = 0; i < 64; i++) {
  const leaf = new Leaf(i);
  leaf.mark = i;
  leaf.owner = leaf;
  const crate = new Crate(i);
  crate.mark = i;
  crate.owner = crate;
  const item = new Item(i);
  if (i & 1) item.label = "l" + i;
  pool.push(leaf, crate, item, new Holder(leaf, crate));
}
const leaves: Leaf[] = [];
for (let i = 0; i < 64; i++) leaves.push(pool[i * 4]);

const spare: any = { mark: 1, owner: 2, weight: 3, label: 4, kind: 5 };
pool.push(spare);
for (let how = 1; how <= 5; how++) disturb(pool[pool.length - 1], ["mark", "owner", "weight", "label", "kind"][how - 1], how);
let total = 0;
for (let round = 0; round < 2000; round++) {
  const at = (round & 63) * 4;
  total += twoFamilies(pool[at], pool[at + 1]);
  total += twoFamiliesOfReferences(pool[at], pool[at + 1], pool[at + 1]);
  total += outOfHolder(pool[at + 3]);
  total += untypedTwoFamilies(pool[at], pool[at + 1]);
  total += countUp(pool[at], 3);
  total += fillIfEmpty(pool[at], pool[at]);
  total += storeThenRead(pool[at], pool[at]);
  total += weights(leaves).length;
  total += weightsCounted(leaves);
  total += copyOf(pool[at]).twice;
  total += kindAndLabel(pool[at + 2]);
}
console.log(total);
