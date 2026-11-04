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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=number site=[[w_1]]}, {type=number site=[[w_2]]}] results=[{type=number site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: number, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Greater v0, v1
// CHECK-NEXT: Branch v2 -> taken b2(| 0, 1), notTaken b4(| 0, 1)
// CHECK-NEXT: b2(v3, v4):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v5 = Integer integer=-1
// CHECK-NEXT: v6 = Convert v5 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: b4(v7, v8):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v9 = StrictEq v7, v8
// CHECK-NEXT: Branch v9 -> taken b6(| 0, 1), notTaken b8(| 0, 1)
// CHECK-NEXT: b6(v10, v11):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v12 = Integer
// CHECK-NEXT: v13 = Convert v12 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Return v13
// CHECK-NEXT: b8(v14, v15):
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v16 = Integer
// CHECK-NEXT: v17 = Convert v16 declared={type=number site=[[w_4]]}
// CHECK-NEXT: v18 = Integer
// CHECK-NEXT: v19 = Convert v18 declared={type=number site=[[w_5]]}
// CHECK-NEXT: Jump -> next b10(v17, v19)
// CHECK-NEXT: b10(v20: number, v21: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v23 = Integer integer=3
// CHECK-NEXT: v24 = Less v21, v23
// CHECK-NEXT: Branch v24 -> taken b11(| 0), notTaken b14(| 0)
// CHECK-NEXT: b11(v25):
// CHECK-NEXT: Jump -> next b12()
// CHECK-NEXT: b12():
// CHECK-NEXT: v26 = Add v14, v25
// CHECK-NEXT: v27 = Add v20, v26
// CHECK-NEXT: v28 = Convert v27 declared={type=number site=[[w_4]]}
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b13():
// CHECK-NEXT: v29 = Increment v25
// CHECK-NEXT: v30 = Convert v29 declared={type=number site=[[w_5]]}
// CHECK-NEXT: Jump -> next b10(v28, v30)
// CHECK-NEXT: b14(v31):
// CHECK-NEXT: Jump -> next b15()
// CHECK-NEXT: b15():
// CHECK-NEXT: v32 = Convert v20 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Return v32
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="callsOnOneSide"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=number site=[[w_6]]}, {type=undefined|null|Map<undefined|null|string, number> site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_8]]}] {
// CHECK-NEXT: b0(v0: number, v1: undefined|null|Map<undefined|null|string, number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Integer integer=3
// CHECK-NEXT: v3 = Mod v0, v2
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = StrictEq v3, v4
// CHECK-NEXT: Branch v5 -> taken b2(), notTaken b7()
// CHECK-NEXT: b2():
// CHECK-NEXT: v6 = String string="k"
// CHECK-NEXT: v7 = Integer integer=7
// CHECK-NEXT: v8 = Mod v0, v7
// CHECK-NEXT: v9 = Add v6, v8
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v11 = PropGet v1 key="get"
// CHECK-NEXT: v12 = Call v11, v1, v10 calleeKey="get" calleeName="table.get"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|number site=[[w_10]]} illTypedCause=FromLooseType
// CHECK-NEXT: v14 = TypeTest v13 testedType=undefined
// CHECK-NEXT: Branch v14 -> taken b3(| 0), notTaken b5(| 0)
// CHECK-NEXT: b3(v15):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v16 = PropGet v1 key="set"
// CHECK-NEXT: v17 = Call v16, v1, v10, v0 calleeKey="set" calleeName="table.set"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|Map<undefined|null|string, number> site=[[w_11]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v19 = Convert v0 declared={type=number site=[[w_8]]}
// CHECK-NEXT: Return v19
// CHECK-NEXT: b5(v20):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v21 = Convert v20 declared={type=number} illTypedCause=Assertion
// CHECK-NEXT: v22 = Integer integer=1
// CHECK-NEXT: v23 = Add v21, v22
// CHECK-NEXT: v24 = Convert v23 declared={type=number site=[[w_8]]}
// CHECK-NEXT: Return v24
// CHECK-NEXT: b7():
// CHECK-NEXT: v25 = Integer integer=2
// CHECK-NEXT: v26 = Mul v0, v25
// CHECK-NEXT: v27 = Convert v26 declared={type=number site=[[w_8]]}
// CHECK-NEXT: Return v27
// CHECK-NEXT: }
