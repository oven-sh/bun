// RUN: lower
// OPTIONS: builtin-modules

// A variance annotation lets a cell of numbers take a string.
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    if (list.length > 40) return "array of " + list.length + " with keys " + Object.keys(list).join();
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  for (const [key, member] of Object.entries(value)) parts.push(key + ": " + show(member));
  return "{" + parts.join(", ") + "}";
}

function attempt(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + (error instanceof Error ? error.constructor.name : show(error));
  }
  console.log(label + " -> " + line);
}

class Cell<out T> {
  value: T;
  constructor(value: T) {
    this.value = value;
  }
  put(value: T): void {
    this.value = value;
  }
  swap(other: Cell<T>): void {
    const kept = this.value;
    this.value = other.value;
    other.value = kept;
  }
}

interface Sink<out T> {
  items: T[];
  accept(item: T): number;
}

class Exact<in out T> {
  value: T;
  constructor(value: T) {
    this.value = value;
  }
  put(value: T): void {
    this.value = value;
  }
}

function plusOne(cell: Cell<number>): number {
  return cell.value + 1;
}

function shout(cell: Cell<string>): string {
  return cell.value.toUpperCase();
}

function sum(sink: Sink<number>): number {
  let total = 0;
  for (let i = 0; i < sink.items.length; i++) total += sink.items[i];
  return total;
}

function fillWide(cell: Cell<number | string>, value: number | string): void {
  cell.put(value);
}

let total = 0;
for (let i = 0; i < 2000; i++) {
  const cell = new Cell(i);
  fillWide(cell, i + 1);
  total += plusOne(cell) + shout(new Cell("s")).length + new Exact(i).value;
}
console.log("2000 honest rounds: " + total);

const numbers = new Cell<number>(1);
const wide: Cell<number | string> = numbers;
wide.put("text");
console.log("a string by put: " + typeof numbers.value + " " + show(numbers.value) + " " + JSON.stringify(numbers));
attempt("  plusOne", () => plusOne(numbers));
attempt("  value * 2", () => numbers.value * 2);
attempt("  value.toFixed(1)", () => numbers.value.toFixed(1));

wide.value = "stored";
console.log("a string by a store: " + typeof numbers.value + " " + show(numbers.value));
attempt("  plusOne", () => plusOne(numbers));

const fractions = new Cell<number>(0.5);
fillWide(fractions, "through a function");
console.log("a string through a function: " + typeof fractions.value + " " + show(fractions.value));
attempt("  plusOne", () => plusOne(fractions));

const strings = new Cell<string>("s");
const alsoWide: Cell<number | string> = strings;
const fresh = new Cell<number>(7);
alsoWide.swap(fresh);
console.log("a cell of strings and a cell of numbers swap: " + typeof strings.value + " " + show(strings.value) + ", " + typeof fresh.value + " " + show(fresh.value));
attempt("  shout", () => shout(strings));
attempt("  plusOne", () => plusOne(fresh));

const sink: Sink<number> = {
  items: [1, 2],
  accept(item) {
    return this.items.push(item);
  },
};
const wideSink: Sink<number | string | null> = sink;
wideSink.accept("three");
console.log("a sink of numbers: " + show(sink.items));
attempt("  sum", () => sum(sink));
wideSink.accept(null);
attempt("  sum with null", () => sum(sink));
attempt("  the last one + 1", () => sink.items[3] + 1);
attempt("  the last one's toFixed", () => sink.items[3].toFixed(0));

const nothing: Cell<number | undefined> = new Cell<number>(1);
nothing.put(undefined);
attempt("undefined in a cell of numbers", () => [typeof nothing.value, JSON.stringify(nothing), Object.keys(nothing)]);

export {};

// GENERATED: plusOne sum fillWide Cell accept
// CHECK-LABEL: function {{*}}name="plusOne"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_3]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="value"
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_4]]} illTypedCause=Assertion
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Add v2, v3
// CHECK-NEXT: v5 = Convert v4 declared={type=number site=[[w_3]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sum"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_5]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=number site=[[w_7]]}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_5]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number site=[[w_8]]}
// CHECK-NEXT: v3 = Integer
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_9]]}
// CHECK-NEXT: Jump -> next b2(v2, v4)
// CHECK-NEXT: b2(v5: number, v6: number):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = Convert v6 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v9 = PropGet v0 key="items"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|Array<number> site=[[w_10]]} illTypedCause=Assertion
// CHECK-NEXT: v11 = PropGet v10 key="length"
// CHECK-NEXT: v12 = Convert v11 declared={type=number site=[[w_10]]} illTypedCause=Assertion
// CHECK-NEXT: v13 = Less v8, v12
// CHECK-NEXT: Branch v13 -> taken b3(| 0), notTaken b6(| 0)
// CHECK-NEXT: b3(v14):
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: v15 = PropGet v0 key="items"
// CHECK-NEXT: v16 = Convert v15 declared={type=undefined|null|Array<number> site=[[w_11]]} illTypedCause=Assertion
// CHECK-NEXT: v17 = Convert v14 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v18 = ElemGet v16, v17
// CHECK-NEXT: v19 = Convert v18 declared={type=number site=[[w_12]]} illTypedCause=ContainerWriterUnseen
// CHECK-NEXT: v20 = Add v5, v19
// CHECK-NEXT: v21 = Convert v20 declared={type=number site=[[w_8]]}
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v22 = Increment v17
// CHECK-NEXT: v23 = Convert v22 declared={type=number site=[[w_9]]}
// CHECK-NEXT: Jump -> next b2(v21, v23)
// CHECK-NEXT: b6(v24):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v25 = Convert v5 declared={type=number site=[[w_7]]}
// CHECK-NEXT: Return v25
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="fillWide"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] site=[[w_13]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|number|string site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]], v1: undefined|null|number|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v0 key="put"
// CHECK-NEXT: v3 = Call v2, v0, v1 calleeKey="put" calleeName="cell.put"
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Cell"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_15]] site=[[w_16]]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|[[L_15]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetConstructPrototype v0 layout=[[L_1]]
// CHECK-NEXT: v3 = NewObject v2 layout=[[L_1]]
// CHECK-NEXT: v4 = Convert v3 declared={type=[[L_1]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v5 = CallDirect v4 function=[[f_17]]
// CHECK-NEXT: v6 = Convert v1 declared={type=undefined|null|[[L_15]] site=[[w_18]]} illTypedCause=FromLooseType
// CHECK-NEXT: PropSet v4, v6 key="value"
// CHECK-NEXT: v8 = Undefined
// CHECK-NEXT: v9 = TypeTest v8 testedType=object
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b3(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Jump -> next b4(v10)
// CHECK-NEXT: b3(v11):
// CHECK-NEXT: Jump -> next b4(v4)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="accept"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasThis, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=number site=[[w_19]]}] results=[{type=number site=[[w_20]]}] functionTypes={{*}}[[f_21]]] {
// CHECK-NEXT: b0(v0: anything, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Convert v0 declared={type=undefined|null|[[L_5]]} illTypedCause=Assertion
// CHECK-NEXT: v3 = PropGet v2 key="items"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|Array<number> site=[[w_22]]} illTypedCause=Assertion
// CHECK-NEXT: v5 = PropGet v4 key="push"
// CHECK-NEXT: v6 = Call v5, v4, v1 calleeKey="push" calleeName="this.items.push"
// CHECK-NEXT: ReturnCall v6 casts=[{declared={type=number site=[[w_23]]}}, {declared={type=number site=[[w_20]]}}]
// CHECK-NEXT: }
