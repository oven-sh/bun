// RUN: lower
// OPTIONS: builtin-modules

// Stores an int32 field, read through a getter of an unnamed object, wherever an int32 is declared: variables, fields, parameters, results, setters.
import type { int32 } from "bun";

class Point {
  x: int32 = 1;
  y?: int32;
}
class Factory {
  get point(): Point {
    return new Point();
  }
}
class Owner {
  point = new Point();
  get owned(): Point {
    return this.point;
  }
}
interface Size {
  width: int32;
}
class Kept {
  initialized: int32 = new Factory().point.x;
  #hidden: int32 = 0;
  constructor(public given: int32 = new Factory().point.x) {}
  set hidden(value: int32) {
    this.#hidden = value;
  }
  get hidden(): int32 {
    return this.#hidden;
  }
  keep(value: int32): int32 {
    return value;
  }
}
class Below extends Kept {
  constructor() {
    super(make().point.x);
  }
}

function make(): Factory {
  return new Factory();
}
const owner = new Owner();
function sameOwner(): Owner {
  return owner;
}
function returned(): int32 {
  return new Factory().point.x;
}
const arrow = (): int32 => make().point.x;
function withDefault(n: int32 = new Factory().point.x): int32 {
  return n;
}
function two(a: int32, b: int32): int32 {
  return (a + b) | 0;
}
function count(...all: int32[]): number {
  return all.length;
}
function call(read: () => int32): int32 {
  return read();
}
function* each(): Generator<int32> {
  yield new Factory().point.x;
}

const variable: int32 = new Factory().point.x;
let assigned: int32 = 0;
assigned = make().point.x;
const target = new Point();
target.x = new Factory().point.x;
new Factory().point.x = variable;
const size: Size = { width: new Factory().point.x };
const kept = new Kept();
kept.hidden = make().point.x;
const { x } = new Factory().point;
const { x: renamed } = make().point;
const { y = 4 } = new Factory().point;

sameOwner().owned.x |= 6;
console.log("or", sameOwner().owned.x);
sameOwner().owned.x &= 5;
console.log("and", sameOwner().owned.x);
sameOwner().owned.x <<= 3;
console.log("shift", sameOwner().owned.x);
sameOwner().owned.y ??= 9;
console.log("default", two(sameOwner().owned.y!, 0));

let sum: int32 = 0;
for (let turn = 0; turn < 1000; turn++) sum = (sum + make().point.x) | 0;

let chosen = "";
switch (new Factory().point.x) {
  case 1:
    chosen = "one";
    break;
  default:
    chosen = "other";
}

console.log(variable, assigned, target.x, size.width, kept.initialized, kept.given, kept.hidden, new Below().given);
console.log(
  returned(),
  arrow(),
  withDefault(),
  two(new Factory().point.x, make().point.x),
  count(new Factory().point.x, make().point.x),
);
console.log(
  call(() => new Factory().point.x),
  [...each()].join(),
  new Kept().keep(new Factory().point.x),
  two(x, renamed),
  two(y, 0),
);
console.log(
  sum,
  chosen,
  two(new Factory().point.y ?? 0, 0),
  ["a", "b"][new Factory().point.x],
  `${make().point.x}`,
  new Factory().point.x < 2,
);

// GENERATED: count each hidden Below
// CHECK-LABEL: function {{*}}name="count"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasRestParameter, IsChecked, HasExplicitName] thisType={type=anything} parameters=[{type=Array<i32> site=[[w_1]] flags=[IsFromCompiler, OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_2]]}] {
// CHECK-NEXT: b0(v0: Array<i32>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="length"
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_3]]} illTypedCause=Assertion
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="each"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Generator<i32> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="Factory"
// CHECK-NEXT: v5 = Construct v4 calleeName="Factory"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_5]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=UnprovenCallee
// CHECK-NEXT: v7 = PropGet v6 key="point"
// CHECK-NEXT: v8 = PropGet v7 key="x"
// CHECK-NEXT: v9 = Convert v8 declared={type=i32 site=[[w_7]]} illTypedCause=Assertion
// CHECK-NEXT: v10 = Convert v9 declared={type=i32 site=[[w_8]] flags=[IsInt32Promise]}
// CHECK-NEXT: v11 = Yield v10
// CHECK-NEXT: v12 = ResultAt v11
// CHECK-NEXT: v13 = ResultAt v11 index=1
// CHECK-NEXT: Switch v13 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v12
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v12
// CHECK-NEXT: b4():
// CHECK-NEXT: v14 = Undefined
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="hidden"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=[[L_9]] site=[[w_10]]} parameters=[{type=i32 site=[[w_11]] flags=[IsInt32Promise]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_9]], v1: i32):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v1 declared={type=i32 site=[[w_12]] flags=[IsInt32Promise]}
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: PrivateSet v0, v3, v2 layout=[[L_9]] field=3
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="hidden"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_9]] site=[[w_14]]} results=[{type=i32 site=[[w_15]] flags=[IsInt32Promise]}] {
// CHECK-NEXT: b0(v0: [[L_9]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v2 = PrivateGet v0, v1 layout=[[L_9]] field=3
// CHECK-NEXT: v3 = Convert v2 declared={type=i32 site=[[w_15]] flags=[IsInt32Promise]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Below"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasNewTarget, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_16]]] {
// CHECK-NEXT: b0(v0: function, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Absent
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_17]]
// CHECK-NEXT: v5 = Call v4 calleeName="make"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|[[L_5]] site=[[w_18]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v7 = PropGet v6 key="point"
// CHECK-NEXT: v8 = PropGet v7 key="x"
// CHECK-NEXT: v9 = Convert v8 declared={type=i32 site=[[w_19]]} illTypedCause=Assertion
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|i32 site=[[w_20]] flags=[IsInt32Promise]}
// CHECK-NEXT: v11 = SuperConstruct v3, v1, v10 layout=[[L_21]]
// CHECK-NEXT: v12 = Convert v11 declared={type=[[L_21]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v13 = TypeTest v2 testedType=absent
// CHECK-NEXT: Branch v13 -> taken b2(| 0), notTaken b10(| 0)
// CHECK-NEXT: b2(v14):
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: v16 = TypeTest v15 testedType=object
// CHECK-NEXT: Branch v16 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v17):
// CHECK-NEXT: Jump -> next b8(v17)
// CHECK-NEXT: b4(v18):
// CHECK-NEXT: v19 = TypeTest v18 testedType=undefined
// CHECK-NEXT: Branch v19 -> taken b5(| 0), notTaken b9(| 0)
// CHECK-NEXT: b5(v20):
// CHECK-NEXT: v21 = TypeTest v12 testedType=absent
// CHECK-NEXT: Branch v21 -> taken b6(| 0), notTaken b7(| 0)
// CHECK-NEXT: b6(v22) frequency=Unlikely:
// CHECK-NEXT: v23 = NewRuntimeError runtimeError=UninitializedThis
// CHECK-NEXT: Throw v23
// CHECK-NEXT: b7(v24):
// CHECK-NEXT: Jump -> next b8(v24)
// CHECK-NEXT: b8(v25):
// CHECK-NEXT: Return v25
// CHECK-NEXT: b9(v26) frequency=Unlikely:
// CHECK-NEXT: v27 = NewRuntimeError runtimeError=DerivedConstructorResult name="Below"
// CHECK-NEXT: Throw v27
// CHECK-NEXT: b10(v28) frequency=Unlikely:
// CHECK-NEXT: v29 = NewRuntimeError runtimeError=ThisAlreadyBound
// CHECK-NEXT: Throw v29
// CHECK-NEXT: }
