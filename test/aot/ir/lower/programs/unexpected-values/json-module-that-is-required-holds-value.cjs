// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 1
// STATISTIC: SourceFilesData = 1

// FILE: main.cjs
// A json module that is required holds the value.
const data = require("./data.json");

const log = [];

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (value instanceof Error) return value.constructor.name;
  const parent = Object.getPrototypeOf(value);
  const kind = parent === Object.prototype || parent === Array.prototype ? "" : parent === null ? "bare " : parent.constructor.name + " ";
  const isList = Array.isArray(value);
  const parts = [];
  if (isList) for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
  for (const key of Reflect.ownKeys(value)) {
    if (isList && typeof key === "string" && (key === "length" || /^\d+$/.test(key))) continue;
    parts.push(String(key) + ": " + show(value[key]));
  }
  return kind + (isList ? "[" : "{") + parts.join(", ") + (isList ? "]" : "}");
}

function outcome(run) {
  log.length = 0;
  try {
    const value = run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

function attempt(label, run) {
  console.log(label + " -> " + outcome(run));
}

console.log("strict:", (function () { return this === undefined; })());

function pushes(label) {
  const a = data.arrays[label];
  a.push(1);
  return a.length;
}

function iterates(label) {
  const a = data.arrays[label];
  const seen = [];
  for (const x of a) seen.push(x);
  return seen;
}

function readsCharCode(label) {
  const s = data.strings[label];
  return s.charCodeAt(0);
}

function truncates(label) {
  const n = data.numbers[label];
  return n | 0;
}

function addsOne(label) {
  const n = data.numbers[label];
  return n + 1;
}

function addsMembers(label) {
  const o = data.objects[label];
  return o.x + o.y;
}

function storesMember(label) {
  const o = data.objects[label];
  o.x = 1;
  return o;
}

const table = [
  ["pushes", pushes, "arrays"],
  ["iterates", iterates, "arrays"],
  ["readsCharCode", readsCharCode, "strings"],
  ["truncates", truncates, "numbers"],
  ["addsOne", addsOne, "numbers"],
  ["addsMembers", addsMembers, "objects"],
  ["storesMember", storesMember, "objects"],
];

function everyCase(round) {
  for (const [name, use, kind] of table) {
    const labels = Object.keys(data[kind]);
    for (const label of [...labels, labels[0]]) attempt(round + " " + name + " " + label, () => use(label));
  }
}

everyCase("at first");
for (let i = 0; i < 20; i++) {
  pushes("an array");
  iterates("an array");
  readsCharCode("a text");
  truncates("an integer");
  addsOne("an integer");
  addsMembers("an object");
  storesMember("an object");
}
everyCase("after 20");

function addsOneToTheInteger() {
  const n = data.numbers["an integer"];
  return n + 1;
}
function addsTheMembersOfTheObject() {
  const o = data.objects["an object"];
  return o.x + o.y;
}
attempt("the integer by its constant name", addsOneToTheInteger);
attempt("the object by its constant name", addsTheMembersOfTheObject);
data.numbers["an integer"] = "7";
Object.defineProperty(data.objects["an object"], "y", { get() { log.push("get y"); return "two"; } });
attempt("the integer after the program stored a text there", addsOneToTheInteger);
attempt("the object after the program defined a getter there", addsTheMembersOfTheObject);
data.objects["an object"] = [1, 2];
attempt("the object after the program stored an array there", addsTheMembersOfTheObject);
attempt("the keys", () => Object.keys(data).map(kind => kind + ": " + Object.keys(data[kind]).join("|")));

// FILE: data.json
{
  "arrays": {
    "an array": [5, 6],
    "an object with a length": { "0": 5, "length": 7 },
    "an object whose push is a number": { "push": 1, "length": 2 },
    "a text": "ab",
    "null": null
  },
  "strings": {
    "a text": "abc",
    "an array": ["abc"],
    "a number": 65,
    "null": null
  },
  "numbers": {
    "an integer": 7,
    "a text": "3",
    "null": null,
    "the largest int32": 2147483647,
    "minus zero": -0,
    "a fraction": 2.5,
    "an array of one number": [4],
    "an object": {},
    "true": true
  },
  "objects": {
    "an object": { "x": 1, "y": 2 },
    "texts in another order": { "y": "2", "x": "1" },
    "a member is missing": { "x": 1 },
    "an array": [1, 2],
    "members under a key called __proto__": { "__proto__": { "x": 1, "y": 2 } },
    "null": null,
    "a text": "xy"
  }
}

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: attempt iterates truncates storesMember get
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|function):
// CHECK-NEXT: v2 = Builtin builtin=GlobalThis
// CHECK-NEXT: v3 = PropGet v2 key="console" [isFreeName]
// CHECK-NEXT: v4 = Convert v3 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v5 = PropGet v4 key="log"
// CHECK-NEXT: v6 = Convert v5 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v7 = String string=" -> "
// CHECK-NEXT: v8 = Add v0, v7
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v10 = Call v9, -, v1 calleeName="outcome"
// CHECK-NEXT: v11 = Add v8, v10
// CHECK-NEXT: v12 = Call v6, v4, v11 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="iterates"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="data"
// CHECK-NEXT: v3 = PropGet v2 key="arrays"
// CHECK-NEXT: v4 = ElemGet v3, v0
// CHECK-NEXT: v5 = Data data=[[d_3]]
// CHECK-NEXT: v6 = IteratorOpen v4
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v8 = IteratorResume v6
// CHECK-NEXT: v9 = ResultAt v8
// CHECK-NEXT: v10 = ResultAt v8 index=1
// CHECK-NEXT: Branch v9 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: Return v5
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b5():
// CHECK-NEXT: v11 = PropGet v5 key="push"
// CHECK-NEXT: v12 = Call v11, v5, v10 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b5() role=IterationCleanup subject=v6:
// CHECK-NEXT: v13 = CatchException
// CHECK-NEXT: IteratorClose v6 completion=Throw
// CHECK-NEXT: Rethrow v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="truncates"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="data"
// CHECK-NEXT: v3 = PropGet v2 key="numbers"
// CHECK-NEXT: v4 = ElemGet v3, v0
// CHECK-NEXT: v5 = Integer
// CHECK-NEXT: v6 = BitOr v4, v5
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="storesMember"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything):
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v2 = CheckInitialized v1 name="data"
// CHECK-NEXT: v3 = PropGet v2 key="objects"
// CHECK-NEXT: v4 = ElemGet v3, v0
// CHECK-NEXT: v5 = Integer integer=1
// CHECK-NEXT: PropSet v4, v5 key="x" mode=Sloppy
// CHECK-NEXT: Return v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="log"
// CHECK-NEXT: v2 = PropGet v1 key="push"
// CHECK-NEXT: v3 = String string="get y"
// CHECK-NEXT: v4 = Call v2, v1, v3 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v5 = String string="two"
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
