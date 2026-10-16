// Every branch here goes both ways, often one way in one loop and often the other way in the next, so that whichever side the compiler lays out of line is run.
interface Leaf { kind: "leaf"; weight: number; label?: string; next?: Leaf; count?: number }
interface Pair { kind: "pair"; left: Tree; right: Tree; note?: string }
interface Empty { kind: "empty" }
interface Marked { kind: "marked"; mark: boolean }
interface Named { kind: "named"; name: string }
interface Sized { kind: "sized"; size: number }
type Tree = Leaf | Pair | Empty | Marked | Named | Sized;

function leavesEarly(value: number, limit: number): number {
  if (value > limit) return -1;
  if (value === limit) return 0;
  let sum = 0;
  for (let i = 0; i < 3; i++) sum += value + i;
  return sum;
}

function callsOnOneSide(value: number, table: Map<string, number>): number {
  if (value % 3 === 0) {
    const key = "k" + (value % 7);
    const found = table.get(key);
    if (found === undefined) {
      table.set(key, value);
      return value;
    }
    return found + 1;
  }
  return value * 2;
}

function readsOptionalFields(leaf: Leaf): number {
  let sum = leaf.weight;
  if (leaf.label) sum += leaf.label.length;
  if (leaf.next) sum += leaf.next.weight;
  if (leaf.count !== undefined) sum += leaf.count;
  return sum;
}

function readsAFieldFewMembersHave(tree: Tree): number {
  const note = (tree as Pair).note;
  if (note) return note.length;
  const weight = (tree as Leaf).weight;
  return weight === undefined ? -1 : weight;
}

function bothArmsAreLong(tree: Tree, depth: number): number {
  if (tree.kind === "pair") {
    let sum = depth;
    sum += bothArmsAreLong(tree.left, depth + 1);
    sum += bothArmsAreLong(tree.right, depth + 1);
    if (tree.note) sum += tree.note.charCodeAt(0);
    return sum;
  } else {
    let sum = 1;
    if (tree.kind === "leaf") sum += readsOptionalFields(tree);
    else if (tree.kind === "named") sum += tree.name.length;
    else if (tree.kind === "sized") sum += tree.size;
    else if (tree.kind === "marked") sum += tree.mark ? 2 : 3;
    return sum * depth;
  }
}

function make(i: number): Tree {
  switch (i % 8) {
    case 0: return { kind: "leaf", weight: i };
    case 1: return { kind: "leaf", weight: i, label: "l" + i };
    case 2: return { kind: "leaf", weight: i + 0.5, next: { kind: "leaf", weight: 1 }, count: i };
    case 3: return { kind: "pair", left: make(i + 1), right: { kind: "empty" } };
    case 4: return { kind: "marked", mark: i % 16 === 4 };
    case 5: return { kind: "named", name: "n" + i };
    case 6: return { kind: "sized", size: i };
    default: return { kind: "pair", left: { kind: "empty" }, right: make(i + 1), note: "note" + i };
  }
}

const table = new Map<string, number>();
let total = 0;
for (let round = 0; round < 4; round++) {
  const limit = round % 2 ? 10 : 1000;
  for (let i = 0; i < 400; i++) {
    total += leavesEarly(i, limit);
    total += callsOnOneSide(round % 2 ? i * 3 : i * 3 + 1, table);
    const tree = make(round % 2 ? i : i * 8 + round);
    total += readsAFieldFewMembersHave(tree);
    total += bothArmsAreLong(tree, 1);
  }
  console.log(round, total, table.size);
}
const odd = make(0) as Leaf & { extra?: number };
(odd as any).extra = 7;
console.log(readsOptionalFields(odd), readsAFieldFewMembersHave(odd), (odd as any).extra);
for (const [key, value] of table) total += key.length + value;
console.log(total);
