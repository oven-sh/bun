// RUN: lower
// OPTIONS: builtin-modules

// A merged interface adds an overload that the method never handles.
function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

interface Calculator {
  double(value: number | string): number;
  total(list: (number | string)[]): number;
  describe(point: { x: number | string }): number;
  pick(value: number | boolean | undefined): number;
}
class Calculator {
  base: number = 1;
  double(n: number): number {
    return n * 2;
  }
  total(list: number[]): number {
    let sum = this.base;
    for (let i = 0; i < list.length; i++) sum += list[i];
    return sum;
  }
  describe(point: { x: number }): number {
    return point.x + 1;
  }
  pick(n: number): number {
    return n + 1;
  }
}

function plusOne(n: number): number {
  return n + 1;
}

const calculator = new Calculator();
let warm = 0;
for (let i = 0; i < 2000; i++) warm += calculator.double(i) + calculator.total([i, 1]) + calculator.describe({ x: i }) + calculator.pick(i + 0.5);
show("2000 honest rounds", () => warm);

show("a string of digits where the method takes a number", () => [calculator.double("4"), typeof calculator.double("4")]);
show("a word", () => [calculator.double("ab"), typeof calculator.double("ab")]);
show("the empty string", () => calculator.double(""));
show("a list of strings", () => [calculator.total(["a", "b"]), typeof calculator.total(["a", "b"])]);
show("its result is typed number: plus one", () => [calculator.total(["a"]) + 1, plusOne(calculator.total(["a"]))]);
show("its result is typed number: times two", () => calculator.total(["2", "3"]) * 2);
show("its result is typed number: toFixed", () => calculator.total(["a"]).toFixed(1));
show("a list of both", () => calculator.total([1, "2", 3]));
show("an object with a string", () => [calculator.describe({ x: "1" }), typeof calculator.describe({ x: "1" }), plusOne(calculator.describe({ x: "1" }))]);
show("a boolean", () => [calculator.pick(true), calculator.pick(false), typeof calculator.pick(true)]);
show("undefined", () => [calculator.pick(undefined), typeof calculator.pick(undefined)]);
show("taken off and called", () => {
  const double: (value: number | string) => number = calculator.double;
  return [double("5"), double(5)];
});
show("as a callback over strings", () => ["1", "x"].map(text => calculator.double(text)));
show("in a typed list", () => {
  const list: number[] = [calculator.total(["a"]), calculator.describe({ x: "b" }), 1];
  return list;
});
show("honest again", () => [calculator.double(4), plusOne(calculator.double(4)), calculator.total([1, 2]), calculator.describe({ x: 1 }), calculator.pick(2.5)]);

// GENERATED: Calculator double total
// CHECK-LABEL: function {{*}}name="Calculator"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_1]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_1]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_2]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="double"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: v1 = Integer integer=2
// CHECK-NEXT: v2 = Mul v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="total"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=[[L_1]]} parameters=[{type=undefined|null|Array<number> flags=[OmitsNull, OmitsUndefined]}] results=[{type=number}] {
// CHECK-NEXT: b0(v0: [[L_1]], v1: undefined|null|Array<number>):
// CHECK-NEXT: v2 = PropGet v0 key="base"
// CHECK-NEXT: v3 = Convert v2 declared={type=number}
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = Convert v4 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v3, v5)
// CHECK-NEXT: b1(v6: number, v7: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v9 = PropGet v1 key="length"
// CHECK-NEXT: v10 = Less v7, v9
// CHECK-NEXT: Branch v10 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: v11 = ElemGet v1, v7
// CHECK-NEXT: v12 = Add v6, v11
// CHECK-NEXT: v13 = Convert v12 declared={type=number}
// CHECK-NEXT: v14 = Increment v7
// CHECK-NEXT: v15 = Convert v14 declared={type=number}
// CHECK-NEXT: Jump -> next b1(v13, v15)
// CHECK-NEXT: b3():
// CHECK-NEXT: v16 = Convert v6 declared={type=number}
// CHECK-NEXT: Return v16
// CHECK-NEXT: }
