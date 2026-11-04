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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v2, v4)
// CHECK-NEXT: b1(v5: number, v6: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = Less v6, v0
// CHECK-NEXT: Branch v8 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v9 = Convert v6 declared={type=number}
// CHECK-NEXT: v10 = Double number=0.5
// CHECK-NEXT: v11 = Add v6, v10
// CHECK-NEXT: v12 = Convert v11 declared={type=number}
// CHECK-NEXT: v13 = String string="junk"
// CHECK-NEXT: v14 = Integer integer=7
// CHECK-NEXT: v15 = BitAnd v6, v14
// CHECK-NEXT: v16 = Add v13, v15
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v18 = NewObject -, v9, v12, v17 layout=[[L_1]] fields=[0, 3, 1]
// CHECK-NEXT: v19 = FinishObject v18
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v21 = PropGet v20 key="label"
// CHECK-NEXT: v22 = PropGet v21 key="length"
// CHECK-NEXT: v23 = PropGet v20 key="id"
// CHECK-NEXT: v24 = Integer integer=3
// CHECK-NEXT: v25 = Mod v23, v24
// CHECK-NEXT: v26 = Add v22, v25
// CHECK-NEXT: v27 = Add v5, v26
// CHECK-NEXT: v28 = Convert v27 declared={type=number}
// CHECK-NEXT: v29 = Increment v6
// CHECK-NEXT: v30 = Convert v29 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v28, v30)
// CHECK-NEXT: b3():
// CHECK-NEXT: v31 = Convert v5 declared={type=number}
// CHECK-NEXT: Return v31
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] captures=[{type=anything variableName="kept"}] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = PropGet v0 key="v"
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
