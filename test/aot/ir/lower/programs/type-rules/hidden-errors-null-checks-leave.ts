// RUN: lower
// OPTIONS: builtin-modules

// `@ts-ignore` hides the three errors that `strictNullChecks` only reports. The declared `number` holds `undefined` at run time, as in plain Bun.
function half(n: number): number {
  // @ts-ignore
  if (n < 0) return;
  return n / 2;
}
class Point {
  // @ts-ignore
  x: number;
}
class Early {
  y: number;
  seen: string;
  constructor() {
    // @ts-ignore
    this.seen = typeof this.y + " " + (this.y + 1);
    this.y = 1;
  }
}
function describe(n: number): string {
  return `${typeof n} ${n} ${n + 1} ${n | 0} ${n * 2 > 1}`;
}
console.log(describe(half(4)), "|", describe(half(-4)));
console.log(describe(new Point().x));
const early = new Early();
console.log(early.seen, "|", describe(early.y));
let total = 0;
for (let i = -3; i < 4; i++) total += half(i) | 0;
console.log(total);

// GENERATED: half describe Point Early
// CHECK-LABEL: function {{*}}name="half"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_1]]}] results=[{type=number site=[[w_2]]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Less v0, v1
// CHECK-NEXT: Branch v2 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v3):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_2]]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: b4(v6):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v7 = Integer integer=2
// CHECK-NEXT: v8 = Div v6, v7
// CHECK-NEXT: v9 = Convert v8 declared={type=number site=[[w_2]]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="describe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_3]]}] results=[{type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeOf v0
// CHECK-NEXT: v2 = ToString v1
// CHECK-NEXT: v3 = String string=" "
// CHECK-NEXT: v4 = ToString v0
// CHECK-NEXT: v5 = String string=" "
// CHECK-NEXT: v6 = Integer integer=1
// CHECK-NEXT: v7 = Add v0, v6
// CHECK-NEXT: v8 = ToString v7
// CHECK-NEXT: v9 = String string=" "
// CHECK-NEXT: v10 = Integer
// CHECK-NEXT: v11 = BitOr v0, v10
// CHECK-NEXT: v12 = ToString v11
// CHECK-NEXT: v13 = String string=" "
// CHECK-NEXT: v14 = Integer integer=2
// CHECK-NEXT: v15 = Mul v0, v14
// CHECK-NEXT: v16 = Integer integer=1
// CHECK-NEXT: v17 = Greater v15, v16
// CHECK-NEXT: v18 = ToString v17
// CHECK-NEXT: v19 = Strcat v2, v3, v4, v5, v8, v9, v12, v13, v18
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Point"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_5]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_5]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_6]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Early"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_7]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_7]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_8]]
// CHECK-NEXT: v5 = PropGet v3 key="y"
// CHECK-NEXT: v6 = TypeOf v5
// CHECK-NEXT: v7 = String string=" "
// CHECK-NEXT: v8 = Add v6, v7
// CHECK-NEXT: v9 = PropGet v3 key="y"
// CHECK-NEXT: v10 = Integer integer=1
// CHECK-NEXT: v11 = Add v9, v10
// CHECK-NEXT: v12 = Add v8, v11
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: PropSet v3, v13 key="seen"
// CHECK-NEXT: v15 = Integer integer=1
// CHECK-NEXT: v16 = Convert v15 declared={type=number site=[[w_10]]}
// CHECK-NEXT: PropSet v3, v16 key="y"
// CHECK-NEXT: v18 = Undefined
// CHECK-NEXT: v19 = TypeTest v18 testedType=object
// CHECK-NEXT: Branch v19 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v20):
// CHECK-NEXT: Jump -> next b4(v20)
// CHECK-NEXT: b3(v21):
// CHECK-NEXT: Jump -> next b4(v3)
// CHECK-NEXT: b4(v22):
// CHECK-NEXT: Return v22
// CHECK-NEXT: }
