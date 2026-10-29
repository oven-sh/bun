// RUN: lower
// OPTIONS: builtin-modules

interface Tree<T> { value: T; children?: Tree<T>[] }
interface K0 { k0: number }
interface K1 { k1: number }
interface K2 { k2: number }
interface K3 { k3: number }
interface K4 { k4: number }
interface K5 { k5: number }
interface K6 { k6: number }
interface K7 { k7: number }
interface K8 { k8: number }
interface K9 { k9: number }
interface K10 { k10: number }
interface K11 { k11: number }
interface K12 { k12: number }
interface K13 { k13: number }
interface K14 { k14: number }
interface K15 { k15: number }
interface K16 { k16: number }
interface K17 { k17: number }
type All = { g0: Tree<K0> } & { g1: Tree<K1> } & { g2: Tree<K2> } & { g3: Tree<K3> } & { g4: Tree<K4> } & { g5: Tree<K5> } & { g6: Tree<K6> } & { g7: Tree<K7> } & { g8: Tree<K8> } & { g9: Tree<K9> } & { g10: Tree<K10> } & { g11: Tree<K11> } & { g12: Tree<K12> } & { g13: Tree<K13> } & { g14: Tree<K14> } & { g15: Tree<K15> } & { g16: Tree<K16> } & { g17: Tree<K17> };
type Same = { g17: Tree<K17> } & { g16: Tree<K16> } & { g15: Tree<K15> } & { g14: Tree<K14> } & { g13: Tree<K13> } & { g12: Tree<K12> } & { g11: Tree<K11> } & { g10: Tree<K10> } & { g9: Tree<K9> } & { g8: Tree<K8> } & { g7: Tree<K7> } & { g6: Tree<K6> } & { g5: Tree<K5> } & { g4: Tree<K4> } & { g3: Tree<K3> } & { g2: Tree<K2> } & { g1: Tree<K1> } & { g0: Tree<K0> };
type Few = { g0: Tree<K0> } & { g1: Tree<K1> };
interface Outer<T> { a: { b: { c: T; again?: Outer<T> } } }
interface Other<T> { a: { b: { c: T; again?: Other<T> } } }
function make(): All { return { g0: { value: { k0: 0 }, children: [{ value: { k0: 100 } }] }, g1: { value: { k1: 1 }, children: [{ value: { k1: 101 } }] }, g2: { value: { k2: 2 }, children: [{ value: { k2: 102 } }] }, g3: { value: { k3: 3 }, children: [{ value: { k3: 103 } }] }, g4: { value: { k4: 4 }, children: [{ value: { k4: 104 } }] }, g5: { value: { k5: 5 }, children: [{ value: { k5: 105 } }] }, g6: { value: { k6: 6 }, children: [{ value: { k6: 106 } }] }, g7: { value: { k7: 7 }, children: [{ value: { k7: 107 } }] }, g8: { value: { k8: 8 }, children: [{ value: { k8: 108 } }] }, g9: { value: { k9: 9 }, children: [{ value: { k9: 109 } }] }, g10: { value: { k10: 10 }, children: [{ value: { k10: 110 } }] }, g11: { value: { k11: 11 }, children: [{ value: { k11: 111 } }] }, g12: { value: { k12: 12 }, children: [{ value: { k12: 112 } }] }, g13: { value: { k13: 13 }, children: [{ value: { k13: 113 } }] }, g14: { value: { k14: 14 }, children: [{ value: { k14: 114 } }] }, g15: { value: { k15: 15 }, children: [{ value: { k15: 115 } }] }, g16: { value: { k16: 16 }, children: [{ value: { k16: 116 } }] }, g17: { value: { k17: 17 }, children: [{ value: { k17: 117 } }] } }; }
function pass(from: Outer<All>): Other<Same> { return from; }
function few(from: Outer<All>): Other<Few> { return from; }
const all = make();
const outer: Outer<All> = { a: { b: { c: all, again: { a: { b: { c: all } } } } } };
const other = pass(outer);
let sum = 0;
sum += other.a.b.c.g0.value.k0 + (other.a.b.again?.a.b.c.g0.children?.[0].value.k0 ?? 0);
sum += other.a.b.c.g1.value.k1 + (other.a.b.again?.a.b.c.g1.children?.[0].value.k1 ?? 0);
sum += other.a.b.c.g2.value.k2 + (other.a.b.again?.a.b.c.g2.children?.[0].value.k2 ?? 0);
sum += other.a.b.c.g3.value.k3 + (other.a.b.again?.a.b.c.g3.children?.[0].value.k3 ?? 0);
sum += other.a.b.c.g4.value.k4 + (other.a.b.again?.a.b.c.g4.children?.[0].value.k4 ?? 0);
sum += other.a.b.c.g5.value.k5 + (other.a.b.again?.a.b.c.g5.children?.[0].value.k5 ?? 0);
sum += other.a.b.c.g6.value.k6 + (other.a.b.again?.a.b.c.g6.children?.[0].value.k6 ?? 0);
sum += other.a.b.c.g7.value.k7 + (other.a.b.again?.a.b.c.g7.children?.[0].value.k7 ?? 0);
sum += other.a.b.c.g8.value.k8 + (other.a.b.again?.a.b.c.g8.children?.[0].value.k8 ?? 0);
sum += other.a.b.c.g9.value.k9 + (other.a.b.again?.a.b.c.g9.children?.[0].value.k9 ?? 0);
sum += other.a.b.c.g10.value.k10 + (other.a.b.again?.a.b.c.g10.children?.[0].value.k10 ?? 0);
sum += other.a.b.c.g11.value.k11 + (other.a.b.again?.a.b.c.g11.children?.[0].value.k11 ?? 0);
sum += other.a.b.c.g12.value.k12 + (other.a.b.again?.a.b.c.g12.children?.[0].value.k12 ?? 0);
sum += other.a.b.c.g13.value.k13 + (other.a.b.again?.a.b.c.g13.children?.[0].value.k13 ?? 0);
sum += other.a.b.c.g14.value.k14 + (other.a.b.again?.a.b.c.g14.children?.[0].value.k14 ?? 0);
sum += other.a.b.c.g15.value.k15 + (other.a.b.again?.a.b.c.g15.children?.[0].value.k15 ?? 0);
sum += other.a.b.c.g16.value.k16 + (other.a.b.again?.a.b.c.g16.children?.[0].value.k16 ?? 0);
sum += other.a.b.c.g17.value.k17 + (other.a.b.again?.a.b.c.g17.children?.[0].value.k17 ?? 0);
console.log(sum, few(outer).a.b.c.g1.value.k1);

// GENERATED: make pass
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = Data data=[[d_3]]
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="pass"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_4]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|[[L_4]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_4]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Convert v0 declared={type=undefined|null|[[L_4]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v1
// CHECK-NEXT: }
