// RUN: lower
// OPTIONS: builtin-modules

// A generic getter reads members of primitives.
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

function get<T, K extends keyof T>(target: T, key: K): T[K] {
  return target[key];
}

function has<T>(target: T, key: keyof T): boolean {
  return target[key] !== undefined;
}

function callMember<T, K extends keyof T>(target: T, key: K, use: (member: T[K], target: T) => unknown): unknown {
  return use(target[key], target);
}

let total = 0;
for (let i = 0; i < 2000; i++) total += get({ a: i, b: "s" }, "a") + get({ a: i, b: "s" }, "b").length + get([i, 1], 0) + get([i], "length");
console.log("2000 rounds with objects and lists: " + total);

attempt("the length of a string", () => get("abc", "length") + 1);
attempt("a letter of a string", () => get("abc", 1).toUpperCase());
attempt("a letter past the end", () => typeof get("abc", 99));
attempt("a letter past the end: a method", () => get("abc", 99).toUpperCase());
attempt("a method of a string", () => typeof get("abc", "toUpperCase"));
attempt("a method of a string, called on it", () => callMember("abc", "toUpperCase", (member, target) => member.call(target)));
attempt("a method of a string, called bare", () => get("abc", "toUpperCase")());
attempt("a method of a number", () => typeof get(5, "toFixed"));
attempt("a method of a number, called on it", () => callMember(5.25, "toFixed", (member, target) => member.call(target, 1)));
attempt("a method of a number, called bare", () => get(5, "toFixed")(1));
attempt("a method of a boolean", () => callMember(true, "valueOf", (member, target) => member.call(target)));
attempt("a method of a big integer", () => callMember(5n, "toString", (member, target) => member.call(target)));
attempt("the description of a symbol", () => get(Symbol("s"), "description"));
attempt("has", () => [has("abc", "length"), has("abc", 0), has("abc", 5), has(5, "toFixed"), has([1], 0), has([1], 1), has({ a: undefined }, "a")]);
attempt("an element past the end of a list", () => [typeof get([1, 2], 99), get([1, 2], 99) + 1]);
attempt("an element at minus one", () => typeof get([1, 2], -1));
attempt("a place of a tuple", () => {
  const tuple: [number, string] = [1, "a"];
  return [get(tuple, 0) + 1, get(tuple, 1).toUpperCase(), get(tuple, "length")];
});
attempt("the name and the length of a function", () => {
  const one: Function = (a: number) => a;
  const other: Function = function named() {};
  return [get(one, "length"), get(other, "name")];
});
attempt("a static member of a class", () => {
  class Point {
    static origin = 7;
  }
  return [get(Point, "origin") + 1, typeof get(Point, "prototype")];
});
attempt("a union of a string and a list", () => {
  const either: string | number[] = process.argv.length > 0 ? "abc" : [1, 2];
  return get(either, "length");
});
attempt("a union of a number and a string: what both have", () => {
  const either: number | string = process.argv.length > 0 ? 5 : "five";
  return callMember(either, "toString", (member, target) => member.call(target));
});

export {};

// GENERATED: has callMember attempt one Point
// CHECK-LABEL: function {{*}}name="has"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|number|string|symbol flags=[OmitsNull, OmitsUndefined]}] results=[{type=boolean}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|number|string|symbol):
// CHECK-NEXT: v2 = ElemGet v0, v1
// CHECK-NEXT: v3 = TypeTest v2 testedType=undefined
// CHECK-NEXT: v4 = LogicalNot v3
// CHECK-NEXT: v5 = Convert v4 declared={type=boolean}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="callMember"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|number|string|symbol flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_1]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|number|string|symbol, v2: undefined|null|[[f_1]]):
// CHECK-NEXT: v3 = ElemGet v0, v1
// CHECK-NEXT: v4 = Call v2, -, v3, v0 calleeName="use"
// CHECK-NEXT: ReturnCall v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_2]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
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
// CHECK-LABEL: function {{*}}name="one"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsChecked] length=1 thisType={type=anything} parameters=[{type=number}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: number):
// CHECK-NEXT: Return v0
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Point"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=BaseConstructor flags=[HasNewTarget, IsChecked, HasExplicitName] thisType={type=anything} results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetConstructPrototype v0 layout=[[L_4]]
// CHECK-NEXT: v2 = NewObject v1 layout=[[L_4]]
// CHECK-NEXT: v3 = Convert v2 declared={type=[[L_4]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
