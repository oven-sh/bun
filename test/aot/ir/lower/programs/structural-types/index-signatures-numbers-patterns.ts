// RUN: lower
// OPTIONS: builtin-modules

// Index signatures of numbers patterns and symbols and in a class.
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

interface Row {
  [column: number]: string;
}

interface Attributes {
  [name: `data-${string}`]: number;
  id: string;
}

interface Tagged {
  [tag: symbol]: number;
}

class Bag {
  [item: string]: number;
  count: number = 0;
}

class Table {
  static [name: string]: number;
  static rows: number = 2;
}

function cell(row: Row, column: number): string {
  return row[column];
}

function cellWidth(row: Row, column: number): number {
  return row[column].length;
}

function inBag(bag: Bag, item: string): number {
  return bag[item];
}

const row: Row = { 0: "a", 2: "ccc" };
show("by number: there", () => [cell(row, 0), cellWidth(row, 2)]);
show("by number: missing", () => [cell(row, 1), typeof cell(row, 1)]);
show("by number: the length of a missing one", () => cellWidth(row, 1));
show("by number: negative, a fraction, far out", () => [cell(row, -1), cell(row, 0.5), cell(row, 2 ** 32)]);
show("by number: a list under the same type", () => {
  const list: Row = ["x", "y"];
  return [cell(list, 1), cell(list, 2), cell(list, -1)];
});
show("by number: a string under the same type", () => {
  const word: Row = "hi";
  return [cell(word, 1), cell(word, 2)];
});

const attributes: Attributes = { id: "main", "data-width": 3 };
show("by a pattern: there", () => [attributes["data-width"], attributes["data-width"] + 1]);
show("by a pattern: missing", () => [attributes["data-height"], attributes["data-height"] + 1]);
show("by a pattern: a computed name", () => {
  const names: `data-${string}`[] = ["data-width", "data-depth", "data-"];
  return names.map(name => attributes[name]);
});

const mark = Symbol("mark");
const other = Symbol("other");
const tagged: Tagged = { [mark]: 1 };
show("by a symbol: there and missing", () => [tagged[mark], tagged[other], tagged[other] + 1]);
show("by a symbol: one that every object answers to", () => typeof tagged[Symbol.toStringTag]);

const bag = new Bag();
show("in a class: the field", () => [bag.count, inBag(bag, "count")]);
show("in a class: missing", () => [bag.apples, inBag(bag, "apples"), bag.apples + 1]);
bag.apples = 3;
show("in a class: after a store", () => [bag.apples, inBag(bag, "apples"), Object.keys(bag)]);
show("in a class: another instance", () => [new Bag().apples, Object.keys(new Bag())]);
show("on the static side", () => [Table.rows, Table.columns, Table.columns + 1, Object.keys(Table)]);

let sum = 0;
for (let i = 0; i < 2000; i++) sum += inBag(bag, i % 2 === 0 ? "apples" : "count") + cellWidth(row, 2);
show("2000 honest rounds", () => sum);
show("then missing ones", () => [inBag(bag, "pears"), cell(row, 7)]);

// GENERATED: cell show Bag
// CHECK-LABEL: function {{*}}name="cell"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string|object flags=[OmitsNull, OmitsUndefined]}, {type=number}] results=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string|object, v1: number):
// CHECK-NEXT: v2 = ElemGet v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=": "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v10 = Call v1 calleeName="run"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="text"
// CHECK-NEXT: v12 = Add v8, v11
// CHECK-NEXT: v13 = Call v6, v4, v12 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v14 = CatchValue
// CHECK-NEXT: v15 = Builtin builtin=GlobalThis
// CHECK-NEXT: v16 = PropGet v15 key="console" [isFreeName]
// CHECK-NEXT: v17 = Convert v16 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="log"
// CHECK-NEXT: v19 = Convert v18 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v20 = String string=": threw "
// CHECK-NEXT: v21 = Add v0, v20
// CHECK-NEXT: v22 = Builtin builtin=GlobalThis
// CHECK-NEXT: v23 = PropGet v22 key="Error" [isFreeName]
// CHECK-NEXT: v24 = Convert v23 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v25 = InstanceOf v14, v24
// CHECK-NEXT: v26 = ToBoolean v25
// CHECK-NEXT: Branch v26 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v27):
// CHECK-NEXT: v28 = PropGet v14 key="constructor"
// CHECK-NEXT: v29 = PropGet v28 key="name"
// CHECK-NEXT: Jump -> next b5(v29)
// CHECK-NEXT: b4(v30):
// CHECK-NEXT: v31 = TypeOf v14
// CHECK-NEXT: Jump -> next b5(v31)
// CHECK-NEXT: b5(v32):
// CHECK-NEXT: v33 = Add v21, v32
// CHECK-NEXT: v34 = Call v19, v17, v33 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v35 = Undefined
// CHECK-NEXT: Return v35
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Bag"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_3]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_3]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_3]]}
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_4]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
