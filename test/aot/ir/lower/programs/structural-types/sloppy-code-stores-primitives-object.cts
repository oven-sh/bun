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
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, IsChecked, HasExplicitName] length=2 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_3]] site=[[w_4]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: undefined|null|string, v2: undefined|null|[[f_3]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Undefined
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5():
// CHECK-NEXT: v5 = GetEnvironmentField v0 layout=[[L_1]]
// CHECK-NEXT: v6 = Call v2 calleeName="run"
// CHECK-NEXT: v7 = Call v5, -, v6 calleeName="show"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b5():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b11(v8)
// CHECK-NEXT: b5() role=CatchHandler:
// CHECK-NEXT: v9 = CatchValue
// CHECK-NEXT: v10 = String string="threw "
// CHECK-NEXT: v11 = Builtin builtin=GlobalThis
// CHECK-NEXT: v12 = PropGet v11 key="Error" [isFreeName]
// CHECK-NEXT: v13 = Convert v12 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v14 = InstanceOf v9, v13 writtenExpression="error instanceof Error"
// CHECK-NEXT: v15 = ToBoolean v14
// CHECK-NEXT: Branch v15 -> taken b6(| 0), notTaken b8(| 0)
// CHECK-NEXT: b6(v16):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v17 = Convert v9 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v18 = PropGet v17 key="constructor"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|function site=[[w_7]]} illTypedCause=Assertion
// CHECK-NEXT: v20 = PropGet v19 key="name"
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|string site=[[w_7]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b10(v21)
// CHECK-NEXT: b8(v22):
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v23 = GetEnvironmentField v0 layout=[[L_1]]
// CHECK-NEXT: v24 = Call v23, -, v9 calleeName="show"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|string site=[[w_8]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b10(v25)
// CHECK-NEXT: b10(v26):
// CHECK-NEXT: v27 = Add v10, v26
// CHECK-NEXT: v28 = Convert v27 declared={type=undefined|null|string site=[[w_5]] flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b11(v28)
// CHECK-NEXT: b11(v29: undefined|null|string):
// CHECK-NEXT: v30 = Builtin builtin=GlobalThis
// CHECK-NEXT: v31 = PropGet v30 key="console" [isFreeName]
// CHECK-NEXT: v32 = Convert v31 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v33 = PropGet v32 key="log"
// CHECK-NEXT: v34 = Convert v33 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v35 = String string=" -> "
// CHECK-NEXT: v36 = Add v1, v35
// CHECK-NEXT: v37 = Add v36, v29
// CHECK-NEXT: v38 = Call v34, v32, v37 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v39 = Undefined
// CHECK-NEXT: Return v39
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="forget"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_9]] flags=[IsExpected, OmitsNull, OmitsUndefined]}] results=[{type=boolean site=[[w_10]]}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_9]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropDelete v0 key="length" mode=Sloppy
// CHECK-NEXT: v2 = Convert v1 declared={type=boolean site=[[w_10]]}
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="storeToThis"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=number site=[[w_11]]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = ToThis v0
// CHECK-NEXT: v2 = Convert v1 declared={type=[[L_9]] site=[[w_12]]} illTypedCause=FromLooseType
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Convert v3 declared={type=number site=[[w_13]]}
// CHECK-NEXT: PropSet v2, v4 key="length" mode=Sloppy
// CHECK-NEXT: v6 = PropGet v2 key="length"
// CHECK-NEXT: v7 = Convert v6 declared={type=number site=[[w_14]]} illTypedCause=Assertion
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Old"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_15]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_15]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_15]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
