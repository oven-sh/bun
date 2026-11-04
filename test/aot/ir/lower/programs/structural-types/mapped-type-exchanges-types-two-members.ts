// RUN: lower
// OPTIONS: builtin-modules

// A mapped type exchanges the types of two members.
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

interface Point {
  x: number;
  name: string;
  live: boolean;
}

type Exchanged<T extends { x: unknown; name: unknown }> = { [K in keyof T as K extends "x" ? "name" : K extends "name" ? "x" : K]: T[K] };
type Prefixed<T> = { [K in keyof T as `old${Capitalize<K & string>}`]: T[K] };
type Getters<T> = { [K in keyof T as `get${Capitalize<K & string>}`]: () => T[K] };

function xOf<T extends { x: unknown }>(o: T): T["x"] {
  return o.x;
}

function nameOf<T extends { name: unknown }>(o: T): T["name"] {
  return o.name;
}

function set<T, K extends keyof T>(target: T, key: K, value: T[K]): void {
  target[key] = value;
}

const yes: boolean = process.argv.length > 0;

const point: Point = { x: 1, name: "p", live: true };
const exchanged: Exchanged<Point> = { name: 2, x: "q", live: false };
const sameOrder: Exchanged<Point> = { x: "r", name: 3, live: true };
const prefixed: Prefixed<Point> = { oldX: 4, oldName: "s", oldLive: true };
const getters: Getters<Point> = { getX: () => 5, getName: () => "t", getLive: () => false };

let total = 0;
for (let i = 0; i < 2000; i++) total += xOf(point) + nameOf(point).length;
console.log("2000 rounds with the first shape: " + total);

attempt("the first shape", () => [xOf(point) + 1, nameOf(point).toUpperCase(), Object.keys(point), JSON.stringify(point)]);
attempt("the exchanged shape", () => [xOf(exchanged).toUpperCase(), nameOf(exchanged) + 1, Object.keys(exchanged), JSON.stringify(exchanged)]);
attempt("the exchanged shape in the first one's order", () => [xOf(sameOrder).toUpperCase(), nameOf(sameOrder) + 1, Object.keys(sameOrder), JSON.stringify(sameOrder)]);
attempt("the first shape again", () => [xOf(point) + 1, nameOf(point).toUpperCase()]);
attempt("in one list", () => [point, exchanged, sameOrder].map(o => typeof o.x + " " + typeof o.name + " " + String(o.x) + String(o.name)));
attempt("prefixed", () => [prefixed.oldX + 1, prefixed.oldName.toUpperCase(), prefixed.oldLive, Object.keys(prefixed)]);
attempt("getters", () => [getters.getX() + 1, getters.getName().toUpperCase(), getters.getLive(), Object.keys(getters)]);

set(exchanged, yes ? "x" : "name", 9);
attempt("a union key on the exchanged shape: a number in its x", () => [typeof exchanged.x, JSON.stringify(exchanged), exchanged.x + "!"]);
attempt("a union key on the exchanged shape: a method", () => exchanged.x.toUpperCase());
set(prefixed, yes ? "oldX" : "oldName", "text");
attempt("a union key on the prefixed shape", () => [typeof prefixed.oldX, prefixed.oldX + 1, JSON.stringify(prefixed)]);
set(getters, yes ? "getX" : "getName", () => "from the other getter");
attempt("a union key on the getters", () => [typeof getters.getX(), getters.getX() + 1]);
attempt("a union key on the getters: a method of the result", () => getters.getX().toFixed(1));

export {};

// GENERATED: attempt set getX getLive
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_1]]):
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v5 = Call v1 calleeName="run"
// CHECK-NEXT: v6 = Call v4, -, v5 calleeName="show"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b6(v7)
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v8 = CatchValue
// CHECK-NEXT: v9 = String string="threw "
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="Error" [isFreeName]
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v13 = InstanceOf v8, v12
// CHECK-NEXT: v14 = ToBoolean v13
// CHECK-NEXT: Branch v14 -> taken b3(| 0), notTaken b4(| 0)
// CHECK-NEXT: b3(v15):
// CHECK-NEXT: v16 = PropGet v8 key="constructor"
// CHECK-NEXT: v17 = PropGet v16 key="name"
// CHECK-NEXT: Jump -> next b5(v17)
// CHECK-NEXT: b4(v18):
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v20 = Call v19, -, v8 calleeName="show"
// CHECK-NEXT: Jump -> next b5(v20)
// CHECK-NEXT: b5(v21):
// CHECK-NEXT: v22 = Add v9, v21
// CHECK-NEXT: v23 = Convert v22 declared={type=undefined|null|string flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b6(v23)
// CHECK-NEXT: b6(v24: undefined|null|string):
// CHECK-NEXT: v25 = Builtin builtin=GlobalThis
// CHECK-NEXT: v26 = PropGet v25 key="console" [isFreeName]
// CHECK-NEXT: v27 = Convert v26 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v28 = PropGet v27 key="log"
// CHECK-NEXT: v29 = Convert v28 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v30 = String string=" -> "
// CHECK-NEXT: v31 = Add v0, v30
// CHECK-NEXT: v32 = Add v31, v24
// CHECK-NEXT: v33 = Call v29, v27, v32 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v34 = Undefined
// CHECK-NEXT: Return v34
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|number|string|symbol flags=[OmitsNull, OmitsUndefined]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|number|string|symbol, v2: anything):
// CHECK-NEXT: ElemSet v0, v1, v2
// CHECK-NEXT: v4 = Undefined
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="getX"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Integer integer=5
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="getLive"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = Boolean
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
