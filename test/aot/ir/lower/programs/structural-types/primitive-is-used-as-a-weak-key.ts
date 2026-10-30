// RUN: lower
// OPTIONS: builtin-modules

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

const weights = new WeakMap<HasLength, number>();
const seen = new WeakSet<HasLength>();

function remember(item: HasLength, weight: number): number | undefined {
  weights.set(item, weight);
  return weights.get(item);
}

function recall(item: HasLength): number | undefined {
  return weights.get(item);
}

function known(item: HasLength): boolean {
  return weights.has(item);
}

function forget(item: HasLength): boolean {
  return weights.delete(item);
}

function mark(item: HasLength): boolean {
  seen.add(item);
  return seen.has(item);
}

function marked(item: HasLength): boolean {
  return seen.has(item);
}

function weakly(item: HasLength): number | undefined {
  return new WeakRef(item).deref()?.length;
}

let warm = 0;
for (let i = 0; i < 2000; i++) {
  const honest = { length: i };
  warm += (remember(honest, i) ?? 0) + (recall(honest) ?? 0) + (known(honest) ? 1 : 0) + (forget(honest) ? 1 : 0) + (mark(honest) ? 1 : 0) + (marked(honest) ? 1 : 0) + (weakly(honest) ?? 0);
}
console.log("after 2000 literals", warm);

const values: [string, HasLength][] = [
  ["literal", { length: 1 }],
  ["string", "abc"],
  ["empty string", ""],
  ["array", [1]],
  ["function", remember],
  ["String object", new String("abc")],
];
for (const [name, value] of values) {
  attempt(name + ": get before", () => recall(value));
  attempt(name + ": has before", () => known(value));
  attempt(name + ": delete before", () => forget(value));
  attempt(name + ": set", () => remember(value, 5));
  attempt(name + ": get after", () => recall(value));
  attempt(name + ": has after", () => known(value));
  attempt(name + ": add", () => mark(value));
  attempt(name + ": marked", () => marked(value));
  attempt(name + ": WeakRef", () => weakly(value));
}

function keyed(key: {} & object, value: number): number | undefined {
  return new WeakMap<object, number>([[key, value]]).get(key);
}
attempt("an object key", () => keyed({}, 1));
attempt("made from entries with a string key", () => new WeakMap<HasLength, number>([[{ length: 1 }, 1], ["abc", 2]]).has("abc"));
attempt("made from members with a string", () => new WeakSet<HasLength>([[1], "abc"]).has("abc"));
attempt("a symbol under a description", () => {
  const notes = new WeakMap<{ description?: string }, string>();
  const local = Symbol("local");
  notes.set(local, "kept");
  return notes.get(local);
});
attempt("a registered symbol under a description", () => {
  const notes = new WeakMap<{ description?: string }, string>();
  notes.set(Symbol.for("registered"), "kept");
  return notes.get(Symbol.for("registered"));
});

// GENERATED: remember mark weakly keyed
// CHECK-LABEL: function {{*}}name="remember"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}, {type=number site=[[w_3]]}] results=[{type=undefined|number site=[[w_4]]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: undefined|null|string|[[L_1]], v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v3 = CheckInitialized v2 name="weights"
// CHECK-NEXT: v4 = PropGet v3 key="set"
// CHECK-NEXT: v5 = Call v4, v3, v0, v1 calleeKey="set" calleeName="weights.set"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|WeakMap<undefined|null|string|[[L_1]], number> site=[[w_7]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v7 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v8 = CheckInitialized v7 name="weights"
// CHECK-NEXT: v9 = PropGet v8 key="get"
// CHECK-NEXT: v10 = Call v9, v8, v0 calleeKey="get" calleeName="weights.get"
// CHECK-NEXT: ReturnCall v10 casts=[{declared={type=undefined|number site=[[w_8]]}}, {declared={type=undefined|number site=[[w_4]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="mark"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|[[L_1]] site=[[w_9]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=boolean site=[[w_10]]}] {
// CHECK-NEXT: b0(v0: undefined|null|string|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="seen"
// CHECK-NEXT: v3 = PropGet v2 key="add"
// CHECK-NEXT: v4 = Call v3, v2, v0 calleeKey="add" calleeName="seen.add"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|WeakSet<undefined|null|string|[[L_1]]> site=[[w_12]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v7 = CheckInitialized v6 name="seen"
// CHECK-NEXT: v8 = PropGet v7 key="has"
// CHECK-NEXT: v9 = Call v8, v7, v0 calleeKey="has" calleeName="seen.has"
// CHECK-NEXT: ReturnCall v9 casts=[{declared={type=boolean site=[[w_13]]}}, {declared={type=boolean site=[[w_10]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="weakly"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|[[L_1]] site=[[w_14]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=undefined|number site=[[w_15]]}] {
// CHECK-NEXT: b0(v0: undefined|null|string|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="WeakRef" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(WeakRef) flags=[IsExpected]}
// CHECK-NEXT: v4 = Construct v3, -, v0 calleeName="WeakRef"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|WeakRef site=[[w_16]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v6 = PropGet v5 key="deref"
// CHECK-NEXT: v7 = Call v6, v5 calleeKey="deref" calleeName="deref"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|string|[[L_1]] site=[[w_16]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: v9 = TypeTest v8 testedType=undefined|null
// CHECK-NEXT: Branch v9 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v10):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v11 = Undefined
// CHECK-NEXT: Jump -> next b5(v11)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: v13 = PropGet v12 key="length"
// CHECK-NEXT: Jump -> next b5(v13)
// CHECK-NEXT: b5(v14):
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|number site=[[w_15]]}
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="keyed"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|object site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}, {type=number site=[[w_18]]}] results=[{type=undefined|number site=[[w_19]]}] {
// CHECK-NEXT: b0(v0: undefined|null|object, v1: number):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="WeakMap" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(WeakMap) flags=[IsExpected]}
// CHECK-NEXT: v5 = NewArray v0, v1 contents=undefined|null|number|object
// CHECK-NEXT: v6 = NewArray v5 contents=anything
// CHECK-NEXT: v7 = Construct v4, -, v6 calleeName="WeakMap"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|WeakMap<undefined|null|object, number> site=[[w_20]] flags=[OmitsNull, OmitsUndefined]} illTypedCause=FromLooseType
// CHECK-NEXT: v9 = PropGet v8 key="get"
// CHECK-NEXT: v10 = Call v9, v8, v0 calleeKey="get" calleeName="get"
// CHECK-NEXT: ReturnCall v10 casts=[{declared={type=undefined|number site=[[w_20]]}}, {declared={type=undefined|number site=[[w_19]]}}]
// CHECK-NEXT: }
