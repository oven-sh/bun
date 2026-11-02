// RUN: lower
// OPTIONS: builtin-modules

function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (ArrayBuffer.isView(value)) return value.constructor.name + "<" + Array.prototype.join.call(value, " ") + ">";
  let text;
  try {
    text = String.prototype.valueOf.call(value);
  } catch {
    const parts = [];
    for (const key of Reflect.ownKeys(value)) parts.push(String(key) + ": " + show(value[key]));
    return "{" + parts.join(", ") + "}";
  }
  return "String object " + JSON.stringify(text);
}

function attempt(label, run) {
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + " -> " + line);
}

function make(text) {
  return (0, eval)("(" + text + ")");
}

function asList(value) {
  return Array.isArray(value) ? value : [value];
}

function asListByTypeof(value) {
  return typeof value === "string" ? [value] : value;
}

function asListByConcat(value) {
  return [].concat(value);
}

function asListByFlat(value) {
  return [value].flat();
}

function totalLength(value) {
  let total = 0;
  for (const text of asList(value)) total += text.length;
  return total;
}

function totalLengthByTypeof(value) {
  let total = 0;
  for (const text of asListByTypeof(value)) total += text.length;
  return total;
}

function joinedUpper(value) {
  return asListByConcat(value)
    .map(text => text.toUpperCase())
    .join("+");
}

function firstText(value) {
  return typeof value === "string" ? value : value[0];
}

function countOf(value) {
  return typeof value === "string" ? 1 : value.length;
}

function classNames(...values) {
  const names = [];
  for (const value of values) {
    if (!value) continue;
    if (typeof value === "string" || typeof value === "number") names.push(value);
    else if (Array.isArray(value)) names.push(classNames(...value));
    else if (typeof value === "object") for (const key in value) if (value[key]) names.push(key);
  }
  return names.join(" ");
}

const uses = [
  ["as a list", asList],
  ["as a list by typeof", asListByTypeof],
  ["as a list by concat", asListByConcat],
  ["as a list by flat", asListByFlat],
  ["total length", totalLength],
  ["total length by typeof", totalLengthByTypeof],
  ["joined upper", joinedUpper],
  ["first text", firstText],
  ["count", countOf],
  ["class names", classNames],
];

const values = [
  "'one'",
  "['one', 'two']",
  "''",
  "[]",
  "[['nested']]",
  "new String('wrapped')",
  "[new String('wrapped')]",
  "new Set(['in', 'a', 'set'])",
  "{ length: 1, 0: 'array-like' }",
  "(function () { return arguments; })('from', 'arguments')",
  "Object.assign(['spreadable off'], { [Symbol.isConcatSpreadable]: false })",
  "{ length: 1, 0: 'spreadable on', [Symbol.isConcatSpreadable]: true }",
  "Object.assign(new String('ab'), { [Symbol.isConcatSpreadable]: true })",
  "new Proxy(['through a proxy'], {})",
  "class Words extends Array {}.of('sub', 'class')",
  "Buffer.from('ab')",
  "5",
  "null",
  "undefined",
  "['one', 2, null]",
  "{ active: true, hidden: 0, 'is-open': 'yes' }",
  "'one'[Symbol.iterator]()",
];

let total = 0;
for (let i = 0; i < 2000; i++) {
  for (const [, use] of uses) total += String(use(i % 2 ? "one" : ["one", "two"])).length;
}
console.log("2000 honest rounds", total);

for (const [name, use] of uses) {
  for (const text of values) {
    attempt(name + " of " + text, () => {
      const given = make(text);
      const result = use(given);
      return result === given && typeof given === "object" && given !== null && !Array.isArray(given) ? "the same object" : result;
    });
  }
}

console.log("bytes made in plain sight", Buffer.from("he").length);

// GENERATED: make asList asListByConcat totalLengthByTypeof
// CHECK-LABEL: function {{*}}name="make"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=GlobalThis
// CHECK-NEXT: v2 = PropGet v1 key="eval" [isFreeName]
// CHECK-NEXT: v3 = Convert v2 declared={type=builtin(Eval) flags=[IsExpected]}
// CHECK-NEXT: v4 = String string="("
// CHECK-NEXT: v5 = Add v4, v0
// CHECK-NEXT: v6 = String string=")"
// CHECK-NEXT: v7 = Add v5, v6
// CHECK-NEXT: v8 = Call v3, -, v7
// CHECK-NEXT: ReturnCall v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="asList"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[IsExpected]}] results=[{type=undefined|null|Array flags=[IsExpected]}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0(v0: undefined|null|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Builtin builtin=Array
// CHECK-NEXT: v2 = Builtin builtin=ArrayIsArray
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeName="Array.isArray"
// CHECK-NEXT: v4 = Convert v3 declared={type=boolean flags=[IsExpected]}
// CHECK-NEXT: v5 = ToBoolean v4
// CHECK-NEXT: Branch v5 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v6):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b6(v0)
// CHECK-NEXT: b4(v7):
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5():
// CHECK-NEXT: v8 = NewArray v0 contents=anything
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b6(v9)
// CHECK-NEXT: b6(v10):
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: Return v11
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="asListByConcat"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|Array<never> flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Data data=[[d_3]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="concat"
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v5 = Call v4, v2, v0 calleeKey="concat" calleeName="concat"
// CHECK-NEXT: ReturnCall v5 casts=[{declared={type=undefined|null|Array<never> flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="totalLengthByTypeof"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_5]]] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_6]]
// CHECK-NEXT: v4 = Call v3, -, v0 calleeName="asListByTypeof"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v6 = IteratorOpen v5
// CHECK-NEXT: Jump -> next b2(v2)
// CHECK-NEXT: b2(v7):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v9 = IteratorResume v6
// CHECK-NEXT: v10 = ResultAt v9
// CHECK-NEXT: v11 = ResultAt v9 index=1
// CHECK-NEXT: Branch v10 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: v12 = Convert v7 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v12
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b7():
// CHECK-NEXT: v13 = PropGet v11 key="length"
// CHECK-NEXT: v14 = Add v7, v13
// CHECK-NEXT: v15 = Convert v14 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b7():
// CHECK-NEXT: Jump -> next b2(v15)
// CHECK-NEXT: b7() role=IterationCleanup subject=v6:
// CHECK-NEXT: v16 = CatchException
// CHECK-NEXT: IteratorClose v6 completion=Throw
// CHECK-NEXT: Rethrow v16
// CHECK-NEXT: }
