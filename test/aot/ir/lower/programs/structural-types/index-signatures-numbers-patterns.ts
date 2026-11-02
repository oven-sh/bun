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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string|object site=[[w_1]] flags=[OmitsNull, OmitsUndefined]}, {type=number site=[[w_2]]}] results=[{type=undefined|null|string site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] {
// CHECK-NEXT: b0(v0: undefined|null|string|object, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = ElemGet v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_4]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="show"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_6]] site=[[w_7]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_6]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b4():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=": "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_8]]
// CHECK-NEXT: v10 = Call v1 calleeName="run"
// CHECK-NEXT: v11 = Call v9, -, v10 calleeName="text"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: v13 = Add v8, v12
// CHECK-NEXT: v14 = Call v6, v4, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b4() role=CatchHandler:
// CHECK-NEXT: v15 = CatchValue
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v21 = String string=": threw "
// CHECK-NEXT: v22 = Add v0, v21
// CHECK-NEXT: v23 = Builtin builtin=GlobalThis
// CHECK-NEXT: v24 = PropGet v23 key="Error" [isFreeName]
// CHECK-NEXT: v25 = Convert v24 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v26 = InstanceOf v15, v25 writtenExpression="error instanceof Error"
// CHECK-NEXT: v27 = ToBoolean v26
// CHECK-NEXT: Branch v27 -> taken b5(| 0), notTaken b7(| 0)
// CHECK-NEXT: b5(v28):
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6():
// CHECK-NEXT: v29 = Convert v15 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v30 = PropGet v29 key="constructor"
// CHECK-NEXT: v31 = Convert v30 declared={type=undefined|null|function site=[[w_10]]} illTypedCause=Assertion
// CHECK-NEXT: v32 = PropGet v31 key="name"
// CHECK-NEXT: v33 = Convert v32 declared={type=undefined|null|string site=[[w_10]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b9(v33)
// CHECK-NEXT: b7(v34):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v35 = TypeOf v15
// CHECK-NEXT: Jump -> next b9(v35)
// CHECK-NEXT: b9(v36):
// CHECK-NEXT: v37 = Add v22, v36
// CHECK-NEXT: v38 = Call v20, v18, v37 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v39 = Undefined
// CHECK-NEXT: Return v39
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Bag"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_11]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_11]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_11]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: v4 = CallDirect v3 function=[[f_12]]
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
