// RUN: lower
// OPTIONS: builtin-modules

// Sloppy code stores to primitives under object types.
function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const parts: string[] = [];
  if (Array.isArray(value)) {
    const list: unknown[] = value;
    for (let i = 0; i < list.length; i++) parts.push(i in list ? show(list[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  const entries: [string, unknown][] = Object.entries(value);
  for (const [key, member] of entries) parts.push(key + ": " + show(member));
  return (Object.getPrototypeOf(value) === null ? "no prototype" : value.constructor.name) + " {" + parts.join(", ") + "}";
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

type HasLength = { length: number };

function setLength(item: HasLength, size: number): number {
  item.length = size;
  return item.length;
}

function increment(item: HasLength): number {
  item.length++;
  return item.length;
}

function rename(item: { name: string }): string {
  item.name = "renamed";
  return item.name;
}

function forget(item: { length?: number }): boolean {
  return delete item.length;
}

function addMember(value: {}): unknown {
  const open: { extra?: number } = value;
  open.extra = 1;
  return open.extra;
}

function kindOfThis(this: HasLength): string {
  return typeof this;
}

function lengthOfThis(this: HasLength): number {
  return this.length;
}

function thisIsTheValue(this: HasLength, value: HasLength): boolean {
  return this === value;
}

function storeToThis(this: HasLength): number {
  this.length = 1;
  return this.length;
}

console.log("sloppy", (function (this: unknown) { return this !== undefined; })());

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = { length: i };
  warm += setLength(honest, 1) + increment(honest) + rename({ name: "n" }).length + (forget({ length: i }) ? 1 : 0) + kindOfThis.call(honest).length + lengthOfThis.call(honest) + storeToThis.call(honest);
}
console.log("after 2000 literals", warm);

const makers: [string, () => HasLength][] = [
  ["literal", () => ({ length: 5 })],
  ["string", () => "hello"],
  ["empty string", () => ""],
  ["array", () => [1, 2, 3, 4, 5]],
  ["function", () => function (a: number) { return a; }],
  ["typed array", () => new Uint8Array(5)],
  ["String object", () => new String("boxed")],
];
for (const [name, make] of makers) {
  attempt(name + ": store 2", () => setLength(make(), 2));
  attempt(name + ": ++", () => increment(make()));
  attempt(name + ": delete", () => forget(make()));
  attempt(name + ": a new member", () => addMember(make()));
  attempt(name + ": typeof this", () => kindOfThis.call(make()));
  attempt(name + ": length of this", () => lengthOfThis.call(make()));
  attempt(name + ": this is the value", () => {
    const value = make();
    return thisIsTheValue.call(value, value);
  });
  attempt(name + ": a store to this", () => storeToThis.call(make()));
}
attempt("rename a function", () => rename(function old() {}));
attempt("rename a class", () => rename(class Old {}));
attempt("a new member on a number, a boolean, a symbol, a bigint", () => [addMember(5), addMember(true), addMember(Symbol("s")), addMember(5n)]);

// GENERATED: attempt forget storeToThis Old
// CHECK-LABEL: function {{*}}name="forget"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=boolean}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_1]]):
// CHECK-NEXT: v1 = PropDelete v0 key="length" mode=Sloppy
// CHECK-NEXT: v2 = Convert v1 declared={type=boolean}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="storeToThis"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = ToThis v0
// CHECK-NEXT: v2 = Convert v1 declared={type=[[L_1]]}
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: PropSet v2, v3 key="length" mode=Sloppy
// CHECK-NEXT: v5 = PropGet v2 key="length"
// CHECK-NEXT: v6 = Convert v5 declared={type=number}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_2]]):
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_3]]
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
// CHECK-NEXT: v19 = GetModuleVariable variable=[[g_3]]
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
// CHECK-LABEL: function {{*}}name="Old"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_4]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
