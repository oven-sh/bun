// RUN: lower
// OPTIONS: builtin-modules

// Equal primitives under an object type are equal.
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

function same(a: HasLength, b: HasLength): boolean {
  return a === b;
}

function different(a: HasLength, b: HasLength): boolean {
  return a !== b;
}

function looselySame(a: HasLength, b: HasLength): boolean {
  return a == b;
}

function sameAnything(a: {}, b: {}): boolean {
  return a === b;
}

function looselySameAnything(a: {}, b: {}): boolean {
  return a == b;
}

function sameValue(a: {}, b: {}): boolean {
  return Object.is(a, b);
}

function whichCase(value: {}, first: {}, second: {}): string {
  switch (value) {
    case first:
      return "first";
    case second:
      return "second";
    default:
      return "neither";
  }
}

function glue(a: string, b: string): string {
  return a + b;
}

let warm = 0;
const one = { length: 1 };
for (let i = 0; i < 2000; i++) {
  const other = { length: 1 };
  warm += (same(one, one) ? 1 : 0) + (same(one, other) ? 1 : 0) + (different(one, other) ? 1 : 0) + (looselySame(one, other) ? 1 : 0);
  warm += (sameAnything(one, other) ? 1 : 0) + (looselySameAnything(one, one) ? 1 : 0) + (sameValue(one, other) ? 1 : 0) + whichCase(one, other, one).length;
}
console.log("after 2000 pairs of objects", warm);

const half = 0.5;
const pairs: [string, {}, {}][] = [
  ["two literals", { a: 1 }, { a: 1 }],
  ["a string and the same text glued", "hello", glue("hel", "lo")],
  ["two glued strings", glue("a", "bc"), glue("ab", "c")],
  ["a long glued string", "x".repeat(40), glue("x".repeat(20), "x".repeat(20))],
  ["empty strings", "", glue("", "")],
  ["a string and a String object", "ab", new String("ab")],
  ["two String objects", new String("ab"), new String("ab")],
  ["1 and 0.5 + 0.5", 1, half + half],
  ["0 and -0", 0, -0],
  ["NaN and NaN", NaN, NaN],
  ["NaN and 0 / 0", NaN, (half - half) / (half - half)],
  ["2 ** 31 twice", 2 ** 31, 2147483647 + 1],
  ["1 and true", 1, true],
  ["1 and the text 1", 1, "1"],
  ["0 and an empty string", 0, ""],
  ["two equal bigints", 2n ** 70n, 2n ** 69n * 2n],
  ["two small bigints", 5n, 2n + 3n],
  ["a bigint and a number", 5n, 5],
  ["two symbols of one description", Symbol("s"), Symbol("s")],
  ["a registered symbol twice", Symbol.for("s"), Symbol.for("s")],
  ["true and true", true, !false],
  ["an array and its text", [1, 2], "1,2"],
];
for (const [name, a, b] of pairs) {
  attempt(name + ": ===", () => sameAnything(a, b));
  attempt(name + ": ==", () => looselySameAnything(a, b));
  attempt(name + ": Object.is", () => sameValue(a, b));
  attempt(name + ": switch", () => whichCase(a, {}, b));
}

attempt("strings as length holders", () => [same("ab", glue("a", "b")), different("ab", glue("a", "b")), looselySame("ab", glue("a", "b")), same("ab", "ba")]);
attempt("a string and a String object as length holders", () => [same("ab", new String("ab")), looselySame("ab", new String("ab"))]);
attempt("an array and a string as length holders", () => [same(["a"], "a"), looselySame(["a"], "a")]);

const items: {}[] = [glue("a", "b"), half + half, NaN, -0, 2n ** 70n, one];
attempt("indexOf", () => [items.indexOf("ab"), items.indexOf(1), items.indexOf(NaN), items.indexOf(0), items.indexOf(2n ** 70n), items.indexOf(one), items.indexOf({ length: 1 })]);
attempt("includes", () => [items.includes("ab"), items.includes(1), items.includes(NaN), items.includes(0), items.includes(2n ** 70n), items.includes({ length: 1 })]);
attempt("keys of a map", () => {
  const map = new Map<{}, string>(items.map((item, index) => [item, "at " + index]));
  return [map.get("ab"), map.get(1), map.get(NaN), map.get(0), map.get(2n ** 70n), map.get(one), map.get({ length: 1 }), map.size];
});
attempt("members of a set", () => {
  const set = new Set<{}>([...items, "ab", 1, NaN, 0, 2n ** 70n, one, { length: 1 }]);
  return set.size;
});

// GENERATED: different looselySame sameValue attempt
// CHECK-LABEL: function {{*}}name="different"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string|[[L_1]] site=[[w_2]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string|[[L_1]] site=[[w_3]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=boolean site=[[w_4]]}] {
// CHECK-NEXT: b0(v0: undefined|null|string|[[L_1]], v1: undefined|null|string|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = StrictEq v0, v1
// CHECK-NEXT: v3 = LogicalNot v2
// CHECK-NEXT: v4 = Convert v3 declared={type=boolean site=[[w_4]]}
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="looselySame"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string|[[L_1]] site=[[w_5]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|string|[[L_1]] site=[[w_6]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=boolean site=[[w_7]]}] {
// CHECK-NEXT: b0(v0: undefined|null|string|[[L_1]], v1: undefined|null|string|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Eq v0, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=boolean site=[[w_7]]}
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="sameValue"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=boolean site=[[w_8]]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=Object
// CHECK-NEXT: v3 = Builtin builtin=ObjectIs
// CHECK-NEXT: v4 = Call v3, v2, v0, v1 calleeName="Object.is"
// CHECK-NEXT: ReturnCall v4 casts=[{declared={type=boolean site=[[w_9]]}}, {declared={type=boolean site=[[w_8]]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsChecked, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string site=[[w_10]] flags=[OmitsNull, OmitsUndefined]}, {type=undefined|null|[[f_11]] site=[[w_12]] flags=[OmitsNull, OmitsUndefined]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|[[f_11]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull]} illTypedCause=FromLooseType
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5():
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v5 = Call v1 calleeName="run"
// CHECK-NEXT: v6 = Call v4, -, v5 calleeName="show"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string site=[[w_15]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b5():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b11(v7)
// CHECK-NEXT: b5() role=CatchHandler:
// CHECK-NEXT: v8 = CatchValue
// CHECK-NEXT: v9 = String string="threw "
// CHECK-NEXT: v10 = Builtin builtin=GlobalThis
// CHECK-NEXT: v11 = PropGet v10 key="Error" [isFreeName]
// CHECK-NEXT: v12 = Convert v11 declared={type=builtin(Error) flags=[IsExpected]}
// CHECK-NEXT: v13 = InstanceOf v8, v12 writtenExpression="error instanceof Error"
// CHECK-NEXT: v14 = ToBoolean v13
// CHECK-NEXT: Branch v14 -> taken b6(| 0), notTaken b8(| 0)
// CHECK-NEXT: b6(v15):
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: v16 = Convert v8 declared={type=undefined|null|Error flags=[IsExpected]}
// CHECK-NEXT: v17 = PropGet v16 key="constructor"
// CHECK-NEXT: v18 = Convert v17 declared={type=undefined|null|function site=[[w_16]]} illTypedCause=Assertion
// CHECK-NEXT: v19 = PropGet v18 key="name"
// CHECK-NEXT: v20 = Convert v19 declared={type=undefined|null|string site=[[w_16]]} illTypedCause=Assertion
// CHECK-NEXT: Jump -> next b10(v20)
// CHECK-NEXT: b8(v21):
// CHECK-NEXT: Jump -> next b9()
// CHECK-NEXT: b9():
// CHECK-NEXT: v22 = GetModuleVariable variable=[[g_14]]
// CHECK-NEXT: v23 = Call v22, -, v8 calleeName="show"
// CHECK-NEXT: v24 = Convert v23 declared={type=undefined|null|string site=[[w_17]] flags=[OmitsNull, OmitsUndefined]}
// CHECK-NEXT: Jump -> next b10(v24)
// CHECK-NEXT: b10(v25):
// CHECK-NEXT: v26 = Add v9, v25
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|string site=[[w_13]] flags=[OmitsNull]}
// CHECK-NEXT: Jump -> next b11(v27)
// CHECK-NEXT: b11(v28: undefined|null|string):
// CHECK-NEXT: v29 = Builtin builtin=GlobalThis
// CHECK-NEXT: v30 = PropGet v29 key="console" [isFreeName]
// CHECK-NEXT: v31 = Convert v30 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v32 = PropGet v31 key="log"
// CHECK-NEXT: v33 = Convert v32 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v34 = String string=" -> "
// CHECK-NEXT: v35 = Add v0, v34
// CHECK-NEXT: v36 = Add v35, v28
// CHECK-NEXT: v37 = Call v33, v31, v36 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v38 = Undefined
// CHECK-NEXT: Return v38
// CHECK-NEXT: }
