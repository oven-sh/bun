// RUN: lower
// OPTIONS: builtin-modules

interface Node { name: string; size: number; kids: Node[]; box: { w: number; h: number; at: number[] } }
function tree(): Node {
  return { name: "root", size: 1, box: { w: 1, h: 2, at: [0, 0] }, kids: [
    { name: "a", size: 2, box: { w: 3, h: 4, at: [1, 1] }, kids: [{ name: "a1", size: 3, box: { w: 5, h: 6, at: [2, 2] }, kids: [] }, { name: "a2", size: 4, box: { w: 7, h: 8, at: [3, 3] }, kids: [] }] },
    { name: "b", size: 5, box: { w: 9, h: 10, at: [4, 4] }, kids: [{ name: "b1", size: 6, box: { w: 11, h: 12, at: [5, 5] }, kids: [{ name: "b11", size: 7, box: { w: 13, h: 14, at: [6, 6] }, kids: [] }] }] },
  ] };
}
function deep(): any { return [[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[[{ bottom: ["here", 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17] }]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]]; }
const count = (n: Node): number => n.size + n.box.w + n.box.h + n.box.at[0] + n.name.length + n.kids.reduce((s, k) => s + count(k), 0);
const kept: Node[] = []; let total = 0;
for (let round = 0; round < 8; round++) {
  for (let i = 0; i < 4000; i++) {
    const t = tree(); total += count(t);
    if (i % 500 === 0) kept.push(t.kids[1].kids[0], t.kids[0]);
    if (i % 700 === 0) { t.kids[0].kids.push(tree()); t.box.at.push(i); t.kids[1].box = { w: i, h: i, at: [i] }; kept.push(t); }
  }
  Bun.gc(true);
  for (const k of kept) total += count(k);
}
console.log(total, kept.length, JSON.stringify(tree()).length, JSON.stringify(kept).length);
let d = deep(), levels = 0; while (Array.isArray(d)) { d = d[0]; levels++; } console.log(levels, d.bottom.join());
const many: any[] = []; for (let i = 0; i < 3000; i++) many.push(deep()); Bun.gc(true); let ok = 0; for (const m of many) { let x = m; while (Array.isArray(x)) x = x[0]; ok += x.bottom.length; } console.log(ok);

// GENERATED: tree count
// CHECK-LABEL: function {{*}}name="tree"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_3]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="count"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_5]]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="size"
// CHECK-NEXT: v2 = PropGet v0 key="box"
// CHECK-NEXT: v3 = PropGet v2 key="w"
// CHECK-NEXT: v4 = Add v1, v3
// CHECK-NEXT: v5 = PropGet v0 key="box"
// CHECK-NEXT: v6 = PropGet v5 key="h"
// CHECK-NEXT: v7 = Add v4, v6
// CHECK-NEXT: v8 = PropGet v0 key="box"
// CHECK-NEXT: v9 = PropGet v8 key="at"
// CHECK-NEXT: v10 = Integer
// CHECK-NEXT: v11 = ElemGet v9, v10
// CHECK-NEXT: v12 = Convert v11 declared={type=number site=[[w_7]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v13 = Add v7, v12
// CHECK-NEXT: v14 = PropGet v0 key="name"
// CHECK-NEXT: v15 = PropGet v14 key="length"
// CHECK-NEXT: v16 = Convert v15 declared={type=number site=[[w_8]]} illTypedCause=Assertion
// CHECK-NEXT: v17 = Add v13, v16
// CHECK-NEXT: v18 = PropGet v0 key="kids"
// CHECK-NEXT: v19 = PropGet v18 key="reduce"
// CHECK-NEXT: v20 = NewClosure function=[[f_9]]
// CHECK-NEXT: v21 = Integer
// CHECK-NEXT: v22 = Call v19, v18, v20, v21 calleeKey="reduce" calleeName="n.kids.reduce"
// CHECK-NEXT: v23 = Convert v22 declared={type=number site=[[w_10]]} illTypedCause=FromLooseType
// CHECK-NEXT: v24 = Add v17, v23
// CHECK-NEXT: v25 = Convert v24 declared={type=number site=[[w_5]]}
// CHECK-NEXT: Return v25
// CHECK-NEXT: }
