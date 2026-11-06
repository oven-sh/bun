// RUN: lower
// OPTIONS: builtin-modules

// `constructor` is declared once, in `interface Object`, as a Function for every object. What an object really holds there is its own business.
const lines: string[] = [];
function* numbers() {
  yield 1;
}
async function* later() {
  yield 1;
}
function kind(value: {} | null | undefined): string {
  switch (value?.constructor?.name) {
    case "String":
      return "a string";
    case "Array":
      return "an array";
    default:
      return "something else: " + typeof value?.constructor;
  }
}
function nameOf(value: object): string | undefined {
  return value.constructor.name;
}
function typeOfConstructor(value: object): string {
  const constructor = value.constructor;
  return typeof constructor;
}
function isMadeBy(value: object, maker: Function): boolean {
  return value.constructor === maker;
}
function lengthOf(value: object): unknown {
  return value.constructor.length;
}
class Point {
  constructor(
    readonly x: number,
    readonly y: number,
  ) {}
  again(): Point {
    return new (this.constructor as typeof Point)(this.y, this.x);
  }
}
class Shadowed {
  declare ["constructor"]: typeof Shadowed;
  static label = "static member";
  label(): string {
    return this.constructor.label;
  }
}
const withoutPrototype: object = Object.create(null);
const withNumber: object = Object.create({ constructor: 5 });
const withString: object = { constructor: "text" };
const withObject: object = { constructor: { name: "an object's name" } };
const withUndefined: object = { constructor: undefined };
const withNull: object = { constructor: null };
lines.push([kind("a"), kind([1]), kind(numbers()), kind(later()), kind(withoutPrototype), kind(null), kind(undefined), kind(1), kind(new Point(1, 2))].join(" | "));
lines.push([kind(withNumber), kind(withString), kind(withObject), kind(withUndefined), kind(withNull)].join(" | "));
for (const [title, value] of [
  ["a generator", numbers()],
  ["an async generator", later()],
  ["a generator function's prototype", numbers.prototype],
  ["a number there", withNumber],
  ["a string there", withString],
  ["an object there", withObject],
  ["an instance", new Point(1, 2)],
  ["an array", []],
  ["a function", kind],
  ["a class", Point],
  ["a Map", new Map()],
  ["a promise", Promise.resolve(1)],
  ["an error", new RangeError("x")],
  ["a bound function", kind.bind(null)],
  ["a proxy", new Proxy({}, { get: () => 7 })],
  ["arguments", (function () { return arguments; })()],
] as [string, object][])
  lines.push(`${title}: ${String(nameOf(value))}, ${typeOfConstructor(value)}, ${isMadeBy(value, Object)}, ${String(lengthOf(value))}`);
for (const [title, value] of [
  ["nothing there", withoutPrototype],
  ["undefined there", withUndefined],
  ["null there", withNull],
] as [string, object][]) {
  lines.push(`${title}: ${typeOfConstructor(value)}, ${isMadeBy(value, Object)}`);
  try {
    lines.push(String(nameOf(value)));
  } catch (error) {
    lines.push(`${title}: reading its name threw ${(error as Error).constructor.name}`);
  }
}
const turned = new Point(1, 2).again();
lines.push(`${turned.x} ${turned.y} ${turned.constructor === Point} ${new Shadowed().label()}`);
console.log(lines.join("\n"));

// GENERATED: later kind Point
// CHECK-LABEL: function {{*}}name="later"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, IsGenerator, HasThis, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|AsyncGenerator<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Await v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_1]]}
// CHECK-NEXT: v6 = Yield v5
// CHECK-NEXT: v7 = ResultAt v6
// CHECK-NEXT: v8 = ResultAt v6 index=1
// CHECK-NEXT: Switch v8 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v7
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v7
// CHECK-NEXT: b4():
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Return v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="kind"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b5(v2)
// CHECK-NEXT: b3(v3):
// CHECK-NEXT: v4 = PropGet v3 key="constructor"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|function} illTypedCause=Assertion
// CHECK-NEXT: v6 = TypeTest v5 testedType=undefined|null
// CHECK-NEXT: Branch v6 -> taken b4(| 0), notTaken b6(| 0)
// CHECK-NEXT: b4(v7):
// CHECK-NEXT: Jump -> next b5(v3)
// CHECK-NEXT: b5(v8):
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: Jump -> next b7(v9, v8)
// CHECK-NEXT: b6(v10):
// CHECK-NEXT: v11 = PropGet v10 key="name"
// CHECK-NEXT: Jump -> next b7(v11, v3)
// CHECK-NEXT: b7(v12, v13):
// CHECK-NEXT: v14 = Convert v12 declared={type=undefined|null|string} illTypedCause=Assertion
// CHECK-NEXT: SwitchString v14 strings=["String", "Array"] -> case b8(), case b9(), otherwise b10()
// CHECK-NEXT: b8():
// CHECK-NEXT: v15 = String string="a string"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v16
// CHECK-NEXT: b9():
// CHECK-NEXT: v17 = String string="an array"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v18
// CHECK-NEXT: b10():
// CHECK-NEXT: Jump -> next b11()
// CHECK-NEXT: b11():
// CHECK-NEXT: v19 = String string="something else: "
// CHECK-NEXT: v20 = TypeTest v13 testedType=undefined|null
// CHECK-NEXT: Branch v20 -> taken b12(| 0), notTaken b14(| 0)
// CHECK-NEXT: b12(v21):
// CHECK-NEXT: Jump -> next b13()
// CHECK-NEXT: b13():
// CHECK-NEXT: v22 = Undefined
// CHECK-NEXT: Jump -> next b15(v22)
// CHECK-NEXT: b14(v23):
// CHECK-NEXT: v24 = PropGet v23 key="constructor"
// CHECK-NEXT: Jump -> next b15(v24)
// CHECK-NEXT: b15(v25):
// CHECK-NEXT: v26 = Convert v25 declared={type=undefined|null|function} illTypedCause=Assertion
// CHECK-NEXT: v27 = TypeOf v26
// CHECK-NEXT: v28 = Add v19, v27
// CHECK-NEXT: v29 = Convert v28 declared={type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v29
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Point"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=number site=[[w_4]]}, {type=number site=[[w_5]]}] results=[{type=object flags=[IsFromCompiler]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: anything, v1: number, v2: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetConstructPrototype v0 layout=[[L_7]]
// CHECK-NEXT: v4 = NewObject v3 layout=[[L_7]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_7]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_8]]
// CHECK-NEXT: PropSet v5, v1 key="x"
// CHECK-NEXT: PropSet v5, v2 key="y"
// CHECK-NEXT: v9 = Undefined
// CHECK-NEXT: v10 = TypeTest v9 testedType=object
// CHECK-NEXT: Branch v10 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v11):
// CHECK-NEXT: Jump -> next b4(v11)
// CHECK-NEXT: b3(v12):
// CHECK-NEXT: Jump -> next b4(v5)
// CHECK-NEXT: b4(v13):
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
