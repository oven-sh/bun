// RUN: lower
// OPTIONS: builtin-modules

// Only a generic function that makes a Proxy opens what the function type it goes to yields. One that hands its argument back leaves the type closed, also beside one that wraps another type.
type Sub = { k: number };
type State = { n: number; sub: Sub };
type Other = { o: number };
const holder: { s: State } = { s: { n: 1, sub: { k: 1 } } };
function same<T extends object>(t: T): T { return t }
function wrap<T extends object>(t: T): T { return new Proxy(t, {}) }
const f: (s: State) => State = same;
const g: (o: Other) => Other = wrap;
for (let round = 0; round < 3; round++) {
  holder.s = f({ n: round, sub: { k: 2 } });
  console.log(holder.s.n, holder.s.sub.k, g({ o: 5 }).o);
}

// GENERATED: wrap
// CHECK-LABEL: function {{*}}name="wrap"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]]}] results=[{type=undefined|null|[[L_1]] site=[[w_3]]}] functionTypes={{*}}[[f_4]]] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Proxy
// CHECK-NEXT: v2 = Data data=[[d_5]]
// CHECK-NEXT: v3 = Construct v1, -, v0, v2 calleeName="Proxy"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[L_1]] site=[[w_6]]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
