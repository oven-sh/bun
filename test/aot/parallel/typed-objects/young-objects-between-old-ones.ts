// New objects are born in the holes that dead ones leave between old objects, and in fresh memory. Old objects, arrays, maps and sets that are stored to must keep every new object alive, wherever it was born, through any mix of collections.
const shell = globalThis as any;
const collect: (full: boolean) => void = shell.Bun ? (full: boolean) => shell.Bun.gc(full) : (full: boolean) => (full ? shell.fullGC() : shell.edenGC());
class Leaf {
  constructor(
    public id: number,
    public tag: string,
  ) {}
}
class Pair {
  left: Leaf | Pair | null = null;
  right: Leaf | Pair | null = null;
  constructor(public id: number) {}
}
class Wide {
  a: Leaf | null = null;
  b: Leaf | null = null;
  c: Leaf | null = null;
  d: Leaf | null = null;
  e: Pair | null = null;
  f: number[] = [];
  g: Leaf[] = [];
  constructor(public id: number) {}
}

let leaves: (Leaf | null)[] = [];
let pairs: (Pair | null)[] = [];
const wides: Wide[] = [];
const table = new Map<number, Leaf | Pair>();
const names = new Map<string, Leaf>();
const group = new Set<Leaf | Pair>();
const bag: Record<string, Leaf | Pair> = {};
for (let i = 0; i < 12000; i++) {
  leaves.push(new Leaf(i, "leaf" + (i % 97)));
  if (i % 2 === 0) pairs.push(new Pair(i));
  if (i % 6 === 0) wides.push(new Wide(i));
}
collect(true);

let wrong = 0;
let checked = 0;
function isLeaf(value: Leaf | Pair | null | undefined, id: number): void {
  checked++;
  if (!(value instanceof Leaf) || value.id !== id || value.tag !== "new" + (id % 89)) wrong++;
}
function isPair(value: Leaf | Pair | null | undefined, id: number): void {
  checked++;
  if (!(value instanceof Pair) || value.id !== id) {
    wrong++;
    return;
  }
  isLeaf(value.left, id + 1);
  isLeaf(value.right, id + 2);
}
function fresh(id: number): Leaf {
  return new Leaf(id, "new" + (id % 89));
}
function freshPair(id: number): Pair {
  const pair = new Pair(id);
  pair.left = fresh(id + 1);
  pair.right = fresh(id + 2);
  return pair;
}

for (let round = 0; round < 30; round++) {
  for (let i = round % 5; i < leaves.length; i += 5) leaves[i] = null;
  for (let i = round % 4; i < pairs.length; i += 4) pairs[i] = null;
  collect(round % 3 === 0);
  const base = (round + 1) * 100000;
  for (let i = 0; i < wides.length; i++) {
    const wide = wides[i];
    const id = base + i * 10;
    switch ((i + round) % 5) {
      case 0:
        wide.a = fresh(id);
        break;
      case 1:
        wide.b = fresh(id);
        wide.c = fresh(id + 1);
        break;
      case 2:
        wide.e = freshPair(id);
        break;
      case 3:
        wide.g.push(fresh(id));
        wide.f.push(id);
        break;
      default:
        wide.d = fresh(id);
        wide.g = [fresh(id + 1), fresh(id + 2)];
        wide.f = [id + 1, id + 2];
    }
  }
  for (let i = 0; i < 400; i++) {
    table.set((round * 37 + i) % 1500, i % 2 ? fresh(base + i) : freshPair(base + i));
    names.set("n" + ((round * 11 + i) % 900), fresh(base + i));
    bag["k" + ((round * 7 + i) % 300)] = i % 3 ? fresh(base + i) : freshPair(base + i);
  }
  for (let i = 0; i < 50; i++) group.add(fresh(base + 5000 + i));
  for (let i = round % 5; i < leaves.length; i += 5) leaves[i] = fresh(base + 7000 + i);
  for (let i = round % 4; i < pairs.length; i += 4) pairs[i] = freshPair(base + 50000 + i * 3);
  collect(false);
  let junk = 0;
  for (let i = 0; i < 9000; i++) junk += new Leaf(i, "junk" + (i % 13)).tag.length + new Pair(i).id;
  collect(false);
  if (junk < 0) console.log(junk);
  for (let i = 0; i < wides.length; i++) {
    const wide = wides[i];
    const id = base + i * 10;
    switch ((i + round) % 5) {
      case 0:
        isLeaf(wide.a, id);
        break;
      case 1:
        isLeaf(wide.b, id);
        isLeaf(wide.c, id + 1);
        break;
      case 2:
        isPair(wide.e, id);
        break;
      case 3:
        isLeaf(wide.g[wide.g.length - 1], id);
        break;
      default:
        isLeaf(wide.d, id);
        isLeaf(wide.g[0], id + 1);
        isLeaf(wide.g[1], id + 2);
    }
  }
  for (let i = 0; i < 400; i++) {
    const value = table.get((round * 37 + i) % 1500);
    if (i % 2) isLeaf(value, base + i);
    else isPair(value, base + i);
    isLeaf(names.get("n" + ((round * 11 + i) % 900)), base + i);
  }
  for (let i = 100; i < 400; i++) {
    const value = bag["k" + ((round * 7 + i) % 300)];
    if (i % 3) isLeaf(value, base + i);
    else isPair(value, base + i);
  }
  for (let i = round % 5; i < leaves.length; i += 5) isLeaf(leaves[i], base + 7000 + i);
  for (let i = round % 4; i < pairs.length; i += 4) isPair(pairs[i], base + 50000 + i * 3);
}
let inGroup = 0;
for (const member of group) inGroup += member.id % 1000;
console.log(checked, wrong, table.size, names.size, group.size, inGroup, Object.keys(bag).length);
