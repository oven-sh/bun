// RUN: lower
// OPTIONS: builtin-modules

// Objects whose type depends on a conditional type over a type argument.
declare const console: { log(...a: unknown[]): void };
type Pick3<N> = N extends 3 ? { a: string } : { b: number };
interface Vec<N> { data: Pick3<N>; size: N }
const v: Vec<3> = { data: { a: "x" }, size: 3 };
const w: Vec<4> = { data: { b: 7 }, size: 4 };
function dataOf<N>(it: Vec<N>): Pick3<N> { return it.data; }
console.log(v.data.a, w.data.b, dataOf(v).a, dataOf(w).b);
interface Taker<N extends number> { take: (n: N) => string; last: N }
const t: Taker<1 | 2> = { take: n => (n === 1 ? "one" : "two"), last: 2 };
console.log(t.take(t.last), t.take(1));
type Names = ["zero", "one", "two"];
interface At<N extends 0 | 1 | 2> { name: Names[N] }
const at: At<1> = { name: "one" };
const all: At<0 | 2>[] = [{ name: "zero" }, { name: "two" }];
console.log(at.name, all.map(one => one.name).join());
class Dim<N extends number> { constructor(readonly n: N) {} same(other: Dim<N>) { return other.n === this.n; } }
const d3 = new Dim<3>(3);
console.log(d3.same(new Dim<3>(3)), d3.n);

// GENERATED: Dim same take
// CHECK-LABEL: function {{*}}name="Dim"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_3]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_3]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_4]]
// CHECK-NEXT: PropSet v4, v1 key="n"
// CHECK-NEXT: v7 = Undefined
// CHECK-NEXT: v8 = TypeTest v7 testedType=object
// CHECK-NEXT: Branch v8 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v9):
// CHECK-NEXT: Jump -> next b4(v9)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v11):
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="same"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=[[L_3]] site=[[w_5]]} parameters=[{type=undefined|null|[[L_3]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=boolean site=[[w_7]]}] {
// CHECK-NEXT: b0(v0: [[L_3]], v1: undefined|null|[[L_3]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v1 key="n"
// CHECK-NEXT: v3 = PropGet v0 key="n"
// CHECK-NEXT: v4 = StrictEq v2, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=boolean site=[[w_7]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="take"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=int[1, 2] site=[[w_8]]}] results=[{type=undefined|null|"one"|"two" site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: int[1, 2]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: v2 = StrictEq v0, v1
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = String string="one"
// CHECK-NEXT: Jump -> next b6(v4)
// CHECK-NEXT: b4(v5):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v6 = String string="two"
// CHECK-NEXT: Jump -> next b6(v6)
// CHECK-NEXT: b6(v7):
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|"one"|"two" site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
