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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array):
// CHECK-NEXT: v1 = Builtin builtin=ArrayIsArray
// CHECK-NEXT: v2 = TypeTest v0 testedType=Array
// CHECK-NEXT: Branch v2 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v3):
// CHECK-NEXT: Jump -> next b3(v3)
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = NarrowByTest v0, v4
// CHECK-NEXT: v6 = Builtin builtin=Array
// CHECK-NEXT: v7 = Builtin builtin=ArrayIsArray
// CHECK-NEXT: v8 = Call v7, v6, v5 calleeName="Array.isArray"
// CHECK-NEXT: v9 = ToBoolean v8
// CHECK-NEXT: Branch v9 -> taken b3(v4), notTaken b4(| 0)
// CHECK-NEXT: b3(v10):
// CHECK-NEXT: v11 = NarrowByTest v0, v10
// CHECK-NEXT: Jump -> next b5(v11)
// CHECK-NEXT: b4(v12):
// CHECK-NEXT: v13 = NewArray v5 contents=anything
// CHECK-NEXT: Jump -> next b5(v13)
// CHECK-NEXT: b5(v14):
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="asListByConcat"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = Data data=[[d_1]]
// CHECK-NEXT: v2 = PropGet v1 key="concat"
// CHECK-NEXT: v3 = Call v2, v1, v0 calleeKey="concat" calleeName="concat"
// CHECK-NEXT: ReturnCall v3
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="totalLengthByTypeof"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string):
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = Convert v1 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v4 = Call v3, -, v0 calleeName="asListByTypeof"
// CHECK-NEXT: v5 = IteratorOpen v4
// CHECK-NEXT: Jump -> next b1(v2)
// CHECK-NEXT: b1(v6):
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = IteratorResume v5
// CHECK-NEXT: v9 = ResultAt v8
// CHECK-NEXT: v10 = ResultAt v8 index=1
// CHECK-NEXT: Branch v9 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: Return v6
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b5():
// CHECK-NEXT: v11 = PropGet v10 key="length"
// CHECK-NEXT: v12 = Add v6, v11
// CHECK-NEXT: v13 = Convert v12 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b1(v13)
// CHECK-NEXT: b5() role=IterationCleanup subject=v5:
// CHECK-NEXT: v14 = CatchException
// CHECK-NEXT: IteratorClose v5 completion=Throw
// CHECK-NEXT: Rethrow v14
// CHECK-NEXT: }
