// RUN: lower
// OPTIONS: builtin-modules

// Under allocation pressure, fields of nodes in a long list are turned into accessors and nodes get another prototype: every change succeeds, no TypeError is counted, and typed code reads the nodes as they are then.
interface Cell { id: number; weight: number; label: string; next?: Cell }
function churn(n: number): number { let s = 0; for (let i = 0; i < n; i++) { const junk: Cell = { id: i, weight: i + 0.5, label: "junk" + (i & 7) }; s += junk.label.length + junk.id % 3 } return s }
let list: Cell = { id: 0, weight: 0.25, label: "c0" }
for (let i = 1; i < 20000; i++) list = { id: i, weight: i / 4, label: "c" + i, next: list }
const sharedProto = { kindOf() { return "patched" } }
let index = 0, accessors = 0, prototypes = 0, others = 0
for (let c: Cell | undefined = list; c; c = c.next, index++) {
  if (index % 13 === 0) { const kept = { v: c.weight }; try { Object.defineProperty(c, "weight", { get() { return kept.v }, enumerable: true, configurable: true }); others++ } catch (e) { if (e instanceof TypeError) accessors++; else others++ } }
  if (index % 17 === 0) try { Object.setPrototypeOf(c, sharedProto); others++ } catch (e) { if (e instanceof TypeError) prototypes++; else others++ }
  if (index % 1000 === 0) churn(5000)
}
churn(100000)
let n = 0, weights = 0, patched = 0
for (let c: Cell | undefined = list; c; c = c.next) { n++; weights += c.weight; if ("kindOf" in c) patched++ }
console.log("field made an accessor: TypeError", accessors, "another prototype: TypeError", prototypes, "anything else", others)
console.log(n, weights, patched)

// GENERATED: churn get
// CHECK-LABEL: function {{*}}name="churn"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=number site=[[w_2]]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_3]]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_4]]}
// CHECK-NEXT: Jump -> next b2(v2, v4)
// CHECK-NEXT: b2(v5: number, v6: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = Convert v6 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v9 = Less v8, v0
// CHECK-NEXT: Branch v9 -> taken b3(| 0, 1), notTaken b6(| 0, 1)
// CHECK-NEXT: b3(v10, v11):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v12 = Convert v10 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v13 = Convert v12 declared={type=number}
// CHECK-NEXT: v14 = Double number=0.5
// CHECK-NEXT: v15 = Add v12, v14
// CHECK-NEXT: v16 = Convert v15 declared={type=number}
// CHECK-NEXT: v17 = String string="junk"
// CHECK-NEXT: v18 = Integer integer=7
// CHECK-NEXT: v19 = BitAnd v12, v18
// CHECK-NEXT: v20 = Add v17, v19
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v22 = NewObject -, v13, v16, v21 layout=[[L_5]] fields=[0, 3, 1]
// CHECK-NEXT: v23 = FinishObject v22
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|[[L_5]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v25 = PropGet v24 key="label"
// CHECK-NEXT: v26 = PropGet v25 key="length"
// CHECK-NEXT: v27 = Convert v26 declared={type=number site=[[w_7]]} illTypedCause=Assertion
// CHECK-NEXT: v28 = PropGet v24 key="id"
// CHECK-NEXT: v29 = Integer integer=3
// CHECK-NEXT: v30 = Mod v28, v29
// CHECK-NEXT: v31 = Add v27, v30
// CHECK-NEXT: v32 = Add v5, v31
// CHECK-NEXT: v33 = Convert v32 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v34 = Increment v12
// CHECK-NEXT: v35 = Convert v34 declared={type=number site=[[w_4]]}
// CHECK-NEXT: Jump -> next b2(v33, v35)
// CHECK-NEXT: b6(v36, v37):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v38 = Convert v5 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Return v38
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] captures=[{type=undefined|null|[[L_8]] site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] thisType={type=anything} results=[{type=number site=[[w_10]]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_8]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="v"
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_10]]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
