// RUN: lower
// OPTIONS: builtin-modules

// Parameters and results: a function with typed parameters takes whatever it is handed, however it is called, and what it returns is what it returned, whatever its declared result says.
function describe(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol" || typeof value === "function") return typeof value;
  if (Array.isArray(value)) return "[" + value.map(describe).join(", ") + "]";
  if (value instanceof Map) return "Map(" + describe([...value]) + ")";
  if (value instanceof Set) return "Set(" + describe([...value]) + ")";
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).map(key => key + ": " + describe(record[key])).join(", ") + "}";
  }
  return Object.is(value, -0) ? "-0" : String(value);
}
// An error of the language (a member of null, a call of what is no function) is thrown by plain Bun too: its class is printed, not its text.
function say(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = describe(run());
  } catch (error) {
    line = "THREW " + (error as Error).constructor.name;
  }
  console.log(label + ": " + line);
}
// What nobody can know at build time.
const outside: any = JSON.parse(`{"text": "t", "number": 5, "nothing": null, "list": [1, "two", null], "record": {"x": "s"}, "yes": true}`);

class Point {
  x: number = 1;
  y: number = 2;
}

function double1(value: number): number {
  return value * 2;
}
say("a text for a number, times two", () => double1(outside.text));
function plus2(value: number): number {
  return value + 1;
}
say("a text for a number, plus one", () => plus2(outside.text));
function length3(value: string): number {
  return value.length;
}
say("a number for a text, its length", () => length3(outside.number));
say("null for a text, its length", () => length3(outside.nothing));
function sum4(point: Point): number {
  return point.x + point.y;
}
say("a record for an instance", () => sum4(outside.record));
say("null for an instance", () => sum4(outside.nothing));
say("a number for an instance", () => sum4(outside.number));
function kind5(value: number): string {
  return typeof value;
}
say("no argument for a required parameter", () => (kind5 as any)());
say("more arguments than parameters", () => (kind5 as any)(1, "two", 3));
function sum6(first: number, second: number = 10): unknown[] {
  return [typeof second, first + second];
}
say("null for a parameter with a default", () => sum6(1, outside.nothing));
say("a text for a parameter with a default", () => sum6(1, outside.text));
function join7(...all: number[]): unknown[] {
  let total = 0;
  for (const each of all) total += each;
  return [all.length, total];
}
say("texts among rest parameters", () => join7(...outside.list));
function pick8({ x, y }: Point): unknown[] {
  return [typeof x, typeof y, x + y];
}
say("a record for a destructured parameter", () => pick8(outside.record));
say("null for a destructured parameter", () => pick8(outside.nothing));
function twice9(value: number): number {
  return value + value;
}
say("by call", () => twice9.call(null, outside.text));
say("by apply", () => twice9.apply(null, [outside.text]));
say("by Reflect.apply", () => Reflect.apply(twice9, null, [outside.text]));
say("by a bound function", () => twice9.bind(null, outside.text)());
say("as a callback of map", () => outside.list.map(twice9));
say("by evaluated text", () => new Function("f", "return f('e')")(twice9));
say("as a handler of a promise, started", () => typeof Promise.resolve(outside.text).then(twice9));
class Counter10 {
  count: number = 0;
  add(by: number): number {
    this.count += by;
    return this.count;
  }
}
say("a text for the parameter of a method", () => {
  const counter = new Counter10();
  return [counter.add(outside.text), typeof counter.count, counter.add(1)];
});
say("a method on a receiver of another kind", () => Counter10.prototype.add.call({ count: "c" } as unknown as Counter10, 1));
say("a method on no receiver", () => {
  const add = new Counter10().add;
  return add(1);
});
class Sized11 {
  #size: number = 1;
  set size(value: number) {
    this.#size = value;
  }
  get size(): number {
    return this.#size;
  }
}
say("a text for the parameter of a setter", () => {
  const sized = new Sized11();
  sized.size = outside.text;
  return [typeof sized.size, sized.size + 1];
});
class Made12 {
  constructor(
    public width: number,
    public name: string,
  ) {}
}
say("values of other kinds for the parameters of a constructor", () => {
  const made = new Made12(outside.text, outside.number);
  return [typeof made.width, typeof made.name, made.width + 1, made.name + 1];
});

function answer13(): number {
  return outside.text;
}
say("a text for a declared number", () => {
  const value = answer13();
  return [typeof value, value + 1, value * 2];
});
function answer14(): string {
  return outside.nothing;
}
say("null for a declared text", () => {
  const value = answer14();
  return [value === null, value + "!"];
});
say("null for a declared text, its length", () => answer14().length);
function answer15(): Point {
  return outside.record;
}
say("a record for a declared instance", () => {
  const value = answer15();
  return [typeof value.x, typeof value.y, value instanceof Point];
});
function answer16(): void {
  return outside.number;
}
say("a number out of a function that returns nothing", () => {
  const value = answer16() as unknown;
  return value;
});
function answer17(): never {
  return outside.text as never;
}
say("a function that never returns returns", () => {
  const value: unknown = answer17();
  return value;
});
const answer18 = (): number[] => outside.text;
say("a text for a declared list", () => {
  const value = answer18();
  return [value.length, value[0], typeof value];
});
class Holder19 {
  get width(): number {
    return outside.text;
  }
}
say("a text out of a getter that declares a number", () => {
  const value = new Holder19().width;
  return [typeof value, value + 1];
});
function* numbers20(): Generator<number, string, boolean> {
  const sent = yield outside.text;
  yield typeof sent as unknown as number;
  return outside.number;
}
say("a generator yields, is sent and returns other kinds", () => {
  const running = numbers20();
  return [running.next().value, running.next("sent" as unknown as boolean).value, running.next().value];
});
async function later21(): Promise<number> {
  return outside.text;
}
async function uses21(): Promise<unknown[]> {
  const value = await later21();
  return [typeof value, value + 1];
}
async function awaits22(): Promise<unknown[]> {
  const value: number = await (outside.text as Promise<number>);
  return [typeof value, value + 1];
}

say("in a loop: the 397th argument is a text", () => {
  function add(total: number, value: number): number {
    return total + value;
  }
  let total = 0;
  for (let round = 0; round < 400; round++) total = add(total, round === 396 ? outside.text : 1);
  return total;
});
say("in a loop: the 397th argument is a record for an instance", () => {
  function width(point: Point): number {
    return point.x;
  }
  let last: unknown;
  for (let round = 0; round < 400; round++) last = width(round >= 396 ? outside.record : new Point());
  return last;
});
say("in a loop: the 397th result is a text", () => {
  function next(round: number): number {
    return round === 396 ? outside.text : round;
  }
  let total = 0;
  for (let round = 0; round < 400; round++) total += next(round);
  return total;
});
say("in a loop: the 397th receiver is of another kind", () => {
  const all: Counter10[] = [];
  for (let round = 0; round < 400; round++) all.push(round === 396 ? ({ count: "c", add: () => "other" } as unknown as Counter10) : new Counter10());
  const seen = new Set<unknown>();
  for (const each of all) seen.add(each.add(1));
  return seen;
});

console.log("an async function resolves with another kind: " + describe(await uses21()));
console.log("await of what is no promise: " + describe(await awaits22()));

// GENERATED: numbers20 awaits22 size Made12
// CHECK-LABEL: function {{*}}name="numbers20"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsGenerator, HasThis, TakesCallee, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Generator<number> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything, v1: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="outside"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="text"
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_3]]} illTypedCause=FromLooseType
// CHECK-NEXT: v8 = Yield v7
// CHECK-NEXT: v9 = ResultAt v8
// CHECK-NEXT: v10 = ResultAt v8 index=1
// CHECK-NEXT: Switch v10 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v9
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v9
// CHECK-NEXT: b4():
// CHECK-NEXT: v11 = Convert v9 declared={type=boolean site=[[w_4]]}
// CHECK-NEXT: v12 = TypeOf v11
// CHECK-NEXT: v13 = Convert v12 declared={type=number site=[[w_5]]} illTypedCause=FromLooseType
// CHECK-NEXT: v14 = Yield v13
// CHECK-NEXT: v15 = ResultAt v14
// CHECK-NEXT: v16 = ResultAt v14 index=1
// CHECK-NEXT: Switch v16 cases=[1, 2] -> case b5(), case b6(), otherwise b7()
// CHECK-NEXT: b5():
// CHECK-NEXT: Throw v15
// CHECK-NEXT: b6():
// CHECK-NEXT: Return v15
// CHECK-NEXT: b7():
// CHECK-NEXT: v17 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v18 = CheckInitialized v17 name="outside"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|number|string|symbol|bigint|[[L_6]] flags=[IsExpected]}
// CHECK-NEXT: v20 = PropGet v19 key="number"
// CHECK-NEXT: Return v20
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="awaits22"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=undefined|null|Promise<undefined|null|Array> flags=[IsExpected, OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="outside"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}
// CHECK-NEXT: v4 = PropGet v3 key="text"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|Promise<number> flags=[IsExpected]}
// CHECK-NEXT: v6 = Await v5
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_7]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v8 = TypeOf v7
// CHECK-NEXT: v9 = Integer integer=1
// CHECK-NEXT: v10 = Add v7, v9
// CHECK-NEXT: v11 = NewArray v8, v10 contents=undefined|null|number|"bigint"|"boolean"|"function"|"number"|"object"|"string"|"symbol"|"undefined"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|object site=[[w_8]]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="size"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Setter flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=[[L_9]] site=[[w_10]]} parameters=[{type=number site=[[w_11]]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_9]], v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_12]]}
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: PrivateSet v0, v3, v2 layout=[[L_9]] field=1
// CHECK-NEXT: v5 = Undefined
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="size"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Getter flags=[HasThis, IsChecked, HasExplicitName] thisType={type=[[L_9]] site=[[w_14]]} results=[{type=number site=[[w_15]]}] {
// CHECK-NEXT: b0(v0: [[L_9]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_13]]
// CHECK-NEXT: v2 = PrivateGet v0, v1 layout=[[L_9]] field=1
// CHECK-NEXT: v3 = Convert v2 declared={type=number site=[[w_15]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Made12"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=number site=[[w_16]]}, {type=undefined|null|string site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: number, v2: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetConstructPrototype v0 layout=[[L_18]]
// CHECK-NEXT: v4 = NewObject v3 layout=[[L_18]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_18]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = CallDirect v5 function=[[f_19]]
// CHECK-NEXT: PropSet v5, v1 key="width"
// CHECK-NEXT: PropSet v5, v2 key="name"
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
