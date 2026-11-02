// RUN: lower
// OPTIONS: builtin-modules

// Behind the damage the callee reads a property of null, calls what is no function, or reads a variable in its dead zone, so the run time makes and throws the error. A frame between catches it and returns as usual.
class Point {
  x: number;
  y: number;
  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }
}

let mode = 0;
const nothing: any = null;
const noFunction: any = 5;
function deep(p: Point): number {
  if (mode === 0) return 1;
  delete (p as any).x;
  if (mode === 1) return nothing.field;
  if (mode === 2) return noFunction();
  if (mode === 3) return BigInt(1) + (p.y as any);
  return late;
}
function middle(p: Point): string {
  try {
    return "" + deep(p);
  } catch (error) {
    return (error as Error).name;
  }
}

function holder(p: Point): string {
  const before = p.x;
  const got = middle(p);
  return before + " " + got + " " + p.x + " " + ("x" in p);
}

function run(): void {
  for (let round = 0; round < 500; round++) {
    mode = round % 100 === 99 ? (round + 1) / 100 : 0;
    if (mode === 5) mode = 0;
    const line = holder(new Point(round, 1));
    if (mode || round === 0) console.log(round + ": " + line);
  }
}
run();
const late = 1;

// GENERATED: middle holder Point
// CHECK-LABEL: function {{*}}name="middle"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b3():
// CHECK-NEXT: v1 = String string=""
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v3 = Call v2, -, v0 calleeName="deep"
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_5]]}
// CHECK-NEXT: v5 = Add v1, v4
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: b3() role=CatchHandler:
// CHECK-NEXT: v7 = CatchValue
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v9 = PropGet v8 key="name"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string site=[[w_6]]} illTypedCause=Assertion
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="x"
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_9]]}
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_10]]
// CHECK-NEXT: v4 = Call v3, -, v0 calleeName="middle"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string site=[[w_11]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v6 = String string=" "
// CHECK-NEXT: v7 = Add v2, v6
// CHECK-NEXT: v8 = Add v7, v5
// CHECK-NEXT: v9 = String string=" "
// CHECK-NEXT: v10 = Add v8, v9
// CHECK-NEXT: v11 = PropGet v0 key="x"
// CHECK-NEXT: v12 = Add v10, v11
// CHECK-NEXT: v13 = String string=" "
// CHECK-NEXT: v14 = Add v12, v13
// CHECK-NEXT: v15 = PropHas v0 key="x"
// CHECK-NEXT: v16 = Add v14, v15
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v17
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Point"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=number site=[[w_12]]}, {type=number site=[[w_13]]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: number, v2: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v4 = NewObject v3 layout=[[L_1]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_14]]
// CHECK-NEXT: v7 = Convert v1 declared={type=number site=[[w_15]]}
// CHECK-NEXT: PropSet v5, v7 key="x"
// CHECK-NEXT: v9 = Convert v2 declared={type=number site=[[w_16]]}
// CHECK-NEXT: PropSet v5, v9 key="y"
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: v12 = TypeTest v11 testedType=object
// CHECK-NEXT: Branch v12 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v13):
// CHECK-NEXT: Jump -> next b4(v13)
// CHECK-NEXT: b3(v14):
// CHECK-NEXT: Jump -> next b4(v5)
// CHECK-NEXT: b4(v15):
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
