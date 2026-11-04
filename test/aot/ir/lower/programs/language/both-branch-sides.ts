// RUN: lower
// OPTIONS: builtin-modules

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

// GENERATED: leavesEarly callsOnOneSide
// CHECK-LABEL: function {{*}}name="leavesEarly"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=number}, {type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: number, v1: number):
// CHECK-NEXT: v2 = Greater v0, v1
// CHECK-NEXT: Branch v2 -> taken b1(), notTaken b2()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Integer integer=-1
// CHECK-NEXT: v4 = Convert v3 declared={type=number}
// CHECK-NEXT: Return v4
// CHECK-NEXT: b2():
// CHECK-NEXT: v5 = StrictEq v0, v1
// CHECK-NEXT: Branch v5 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v6 = Integer
// CHECK-NEXT: v7 = Convert v6 declared={type=number}
// CHECK-NEXT: Return v7
// CHECK-NEXT: b4():
// CHECK-NEXT: v8 = Integer
// CHECK-NEXT: v9 = Convert v8 declared={type=number}
// CHECK-NEXT: v10 = Integer
// CHECK-NEXT: v11 = Convert v10 declared={type=number}
// CHECK-NEXT: Jump -> next b5(v9, v11)
// CHECK-NEXT: b5(v12: number, v13: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v15 = Integer integer=3
// CHECK-NEXT: v16 = Less v13, v15
// CHECK-NEXT: Branch v16 -> taken b6(), notTaken b7()
// CHECK-NEXT: b6():
// CHECK-NEXT: v17 = Add v0, v13
// CHECK-NEXT: v18 = Add v12, v17
// CHECK-NEXT: v19 = Convert v18 declared={type=number}
// CHECK-NEXT: v20 = Increment v13
// CHECK-NEXT: v21 = Convert v20 declared={type=number}
// CHECK-NEXT: Jump -> next b5(v19, v21)
// CHECK-NEXT: b7():
// CHECK-NEXT: v22 = Convert v12 declared={type=number}
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="callsOnOneSide"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=number}, {type=undefined|null|Map<undefined|null|string, number> flags=[OmitsNull, OmitsUndefined]}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: number, v1: undefined|null|Map<undefined|null|string, number>):
// CHECK-NEXT: v2 = Integer integer=3
// CHECK-NEXT: v3 = Mod v0, v2
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = StrictEq v3, v4
// CHECK-NEXT: Branch v5 -> taken b1(), notTaken b4()
// CHECK-NEXT: b1():
// CHECK-NEXT: v6 = String string="k"
// CHECK-NEXT: v7 = Integer integer=7
// CHECK-NEXT: v8 = Mod v0, v7
// CHECK-NEXT: v9 = Add v6, v8
// CHECK-NEXT: v10 = PropGet v1 key="get"
// CHECK-NEXT: v11 = Call v10, v1, v9 calleeKey="get" calleeName="table.get"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|number} illTypedCause=FromLooseType
// CHECK-NEXT: v13 = TypeTest v12 testedType=undefined
// CHECK-NEXT: Branch v13 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v14):
// CHECK-NEXT: v15 = PropGet v1 key="set"
// CHECK-NEXT: v16 = Call v15, v1, v9, v0 calleeKey="set" calleeName="table.set"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|Map<undefined|null|string, number> flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v18 = Convert v0 declared={type=number}
// CHECK-NEXT: Return v18
// CHECK-NEXT: b3(v19):
// CHECK-NEXT: v20 = NarrowByTest v12, v19
// CHECK-NEXT: v21 = Integer integer=1
// CHECK-NEXT: v22 = Add v20, v21
// CHECK-NEXT: v23 = Convert v22 declared={type=number}
// CHECK-NEXT: Return v23
// CHECK-NEXT: b4():
// CHECK-NEXT: v24 = Integer integer=2
// CHECK-NEXT: v25 = Mul v0, v24
// CHECK-NEXT: v26 = Convert v25 declared={type=number}
// CHECK-NEXT: Return v26
// CHECK-NEXT: }
