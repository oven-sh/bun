// RUN: lower
// OPTIONS: builtin-modules

// Constant objects that name a member twice.
function repeated() { return { a: 1, b: 2, a: 3, c: { x: 1, x: 2 }, d: 4, e: 5, f: 6, g: 7, h: 8, i: 9, j: 10, k: 11, l: 12, m: 13, n: 14, o: 15, b: "last", 1: "x", 1: "y" }; }
function untyped() { return [{ id: 1, name: "a", at: [1, 2] }, { id: 2, name: "b", at: [3, 4] }, { id: "three", name: 3, at: null }, { name: "d", id: 4 }, { id: 5 }, { id: 6, name: "f", at: [5, 6], more: true }]; }
for (const make of [repeated, untyped]) {
  const a = make(), b = make();
  console.log(JSON.stringify(a), a !== b, Object.keys(a).join());
  if (Array.isArray(a)) { for (const r of a) console.log(Object.keys(r).join(), typeof r.id, typeof r.name); a[0].id = "changed"; a[1].at[0] = 9; a[4].name = "new"; delete a[5].more; }
  else { a.a = 0; a.c.x = 0; delete a.d; }
  console.log(JSON.stringify(a), JSON.stringify(b) === JSON.stringify(make()));
}

// GENERATED: untyped
// CHECK-LABEL: function {{*}}name="untyped"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Array<undefined|null|[[L_1]]> flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_3]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|Array<undefined|null|[[L_1]]|[[L_4]]|[[L_5]]|[[L_6]]> flags=[IsExpected]}
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|Array<undefined|null|[[L_1]]> flags=[IsExpected]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
