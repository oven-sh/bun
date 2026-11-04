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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v1 = String string=""
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v3 = Call v2, -, v0 calleeName="deep"
// CHECK-NEXT: v4 = Add v1, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v6 = CatchValue
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|Error flags=[IsExpected, OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v8 = PropGet v7 key="name"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="holder"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = PropGet v0 key="x"
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v3 = Call v2, -, v0 calleeName="middle"
// CHECK-NEXT: v4 = String string=" "
// CHECK-NEXT: v5 = Add v1, v4
// CHECK-NEXT: v6 = Add v5, v3
// CHECK-NEXT: v7 = String string=" "
// CHECK-NEXT: v8 = Add v6, v7
// CHECK-NEXT: v9 = PropGet v0 key="x"
// CHECK-NEXT: v10 = Add v8, v9
// CHECK-NEXT: v11 = String string=" "
// CHECK-NEXT: v12 = Add v10, v11
// CHECK-NEXT: v13 = PropHas v0 key="x"
// CHECK-NEXT: v14 = Add v12, v13
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Point"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=number}, {type=number}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: number, v2: number):
// CHECK-NEXT: v3 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v4 = NewObject v3 layout=[[L_1]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_1]]}
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_4]]
// CHECK-NEXT: PropSet v5, v1 key="x"
// CHECK-NEXT: PropSet v5, v2 key="y"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: v10 = TypeTest v9 testedType=object
// CHECK-NEXT: Branch v10 -> taken b1(| 0), notTaken b2(v5)
// CHECK-NEXT: b1(v11):
// CHECK-NEXT: Jump -> next b2(v11)
// CHECK-NEXT: b2(v12):
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
