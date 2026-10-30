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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=2 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: undefined|null|string, v2: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v8 = String string=" -> "
// CHECK-NEXT: v9 = Add v1, v8
// CHECK-NEXT: v10 = GetEnvironmentField v0 layout=[[L_1]] field=1
// CHECK-NEXT: v11 = Call v10, -, v2 calleeName="outcome"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v13 = Add v9, v12
// CHECK-NEXT: v14 = Call v7, v5, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v15 = Undefined
// CHECK-NEXT: Return v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="iterates"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|Array flags=[IsExpected]}] functionTypes={{*}}[[f_2]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetEnvironmentField v0 layout=[[L_1]] field=3
// CHECK-NEXT: v3 = CheckInitialized v2 name="data"
// CHECK-NEXT: v4 = PropGet v3 key="arrays"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_3]] flags=[IsExpected]}
// CHECK-NEXT: v6 = ElemGet v5, v1
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|string|Array flags=[IsExpected]}
// CHECK-NEXT: v8 = Data data=[[d_4]]
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|Array<never> flags=[IsExpected]}
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v11 = IteratorOpen v7
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v13 = IteratorResume v11
// CHECK-NEXT: v14 = ResultAt v13
// CHECK-NEXT: v15 = ResultAt v13 index=1
// CHECK-NEXT: Branch v14 -> taken b3(), notTaken b4()
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v10
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b5()
// CHECK-NEXT: b5() handler=b6():
// CHECK-NEXT: v16 = PropGet v10 key="push"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v18 = Call v17, v10, v15 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b6() role=IterationCleanup subject=v11:
// CHECK-NEXT: v19 = CatchException
// CHECK-NEXT: IteratorClose v11 completion=Throw
// CHECK-NEXT: Rethrow v19
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="truncates"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=number flags=[IsExpected]}] functionTypes={{*}}[[f_6]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetEnvironmentField v0 layout=[[L_1]] field=3
// CHECK-NEXT: v3 = CheckInitialized v2 name="data"
// CHECK-NEXT: v4 = PropGet v3 key="numbers"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_7]] flags=[IsExpected]}
// CHECK-NEXT: v6 = ElemGet v5, v1
// CHECK-NEXT: v7 = Convert v6 declared={type=i32 flags=[IsExpected]}
// CHECK-NEXT: v8 = Integer
// CHECK-NEXT: v9 = BitOr v7, v8
// CHECK-NEXT: v10 = Convert v9 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: Return v10
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="storesMember"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|number|string|symbol|bigint|[[L_8]] flags=[IsExpected]}] functionTypes={{*}}[[f_9]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = GetEnvironmentField v0 layout=[[L_1]] field=3
// CHECK-NEXT: v3 = CheckInitialized v2 name="data"
// CHECK-NEXT: v4 = PropGet v3 key="objects"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[L_10]] flags=[IsExpected]}
// CHECK-NEXT: v6 = ElemGet v5, v1
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|number|string|symbol|bigint|[[L_8]] flags=[IsExpected]}
// CHECK-NEXT: v8 = Integer integer=1
// CHECK-NEXT: PropSet v7, v8 key="x" mode=Sloppy
// CHECK-NEXT: Return v7
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsSloppy, HasExplicitName] captures=[{type=undefined|null|Array flags=[IsExpected]}] thisType={type=anything} results=[{type=undefined|null|string flags=[IsExpected]}] functionTypes={{*}}[[f_11]]] {
// CHECK-NEXT: b0(v0: undefined|null|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="push"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v3 = String string="get y"
// CHECK-NEXT: v4 = Call v2, v0, v3 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v5 = String string="two"
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
