// RUN: lower
// OPTIONS: builtin-modules

// The strings array of a tagged template is used like an array sloppy.
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

function pushes(a) {
  a.push(1);
  return a.length;
}
function iterates(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  return seen;
}
function readsCharCodeOfTheFirst(a) {
  return a[0].charCodeAt(0);
}
function readsCharCodeOfTheFirstRawText(a) {
  return a.raw[0].charCodeAt(0);
}
function storesTheFirst(a) {
  a[0] = "changed";
  return a[0];
}
function setsTheLength(a) {
  a.length = 0;
  return a.length;
}
function addsAMember(a) {
  a.x = 1;
  return a.x;
}
function returnsIt(a) {
  return a;
}

for (let i = 0; i < 2000; i++) {
  pushes(["a", "b"]);
  iterates(["a", "b"]);
  readsCharCodeOfTheFirst(["a", "b"]);
  storesTheFirst(["a", "b"]);
  setsTheLength(["a", "b"]);
  addsAMember(["a", "b"]);
}

attempt("pushes as a tag", () => pushes`a${0}b`);
attempt("pushes an array", () => pushes(["a", "b"]));
attempt("iterates as a tag", () => iterates`a${0}b`);
attempt("iterates as a tag with an escape that is no text", () => iterates`\unicode${0}\xerxes${1}c`);
attempt("iterates an array", () => iterates(["a", "b"]));
attempt("readsCharCodeOfTheFirst as a tag", () => readsCharCodeOfTheFirst`a${0}b`);
attempt("readsCharCodeOfTheFirst as a tag with an empty first text", () => readsCharCodeOfTheFirst`${0}b`);
attempt("readsCharCodeOfTheFirst as a tag with an escape that is no text", () => readsCharCodeOfTheFirst`\unicode`);
attempt("readsCharCodeOfTheFirst of an array", () => readsCharCodeOfTheFirst(["a", "b"]));
attempt("readsCharCodeOfTheFirstRawText as a tag", () => readsCharCodeOfTheFirstRawText`\n`);
attempt("readsCharCodeOfTheFirstRawText as a tag with an escape that is no text", () => readsCharCodeOfTheFirstRawText`\unicode`);
attempt("readsCharCodeOfTheFirstRawText of an array", () => readsCharCodeOfTheFirstRawText(["a", "b"]));
attempt("storesTheFirst as a tag", () => storesTheFirst`a${0}b`);
attempt("storesTheFirst of an array", () => storesTheFirst(["a", "b"]));
attempt("setsTheLength as a tag", () => setsTheLength`a${0}b`);
attempt("setsTheLength of an array", () => setsTheLength(["a", "b"]));
attempt("addsAMember as a tag", () => addsAMember`a${0}b`);
attempt("addsAMember to an array", () => addsAMember(["a", "b"]));
attempt("what a tag gets", () => returnsIt`a${0}\n`);
attempt("frozen, and its raw texts too", () => [Object.isFrozen(returnsIt`a`), Object.isFrozen(returnsIt`a`.raw), Array.isArray(returnsIt`a`.raw)]);

const here = () => returnsIt`same place`;
attempt("one place hands over one array", () => [here() === here(), here() === returnsIt`same place`]);
attempt("a loop at one place", () => {
  const seen = new Set();
  for (let i = 0; i < 100; i++) seen.add(returnsIt`in a loop ${i}`);
  return seen.size;
});

// GENERATED: attempt iterates storesTheFirst addsAMember here
// CHECK-LABEL: function {{*}}name="iterates"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|Array flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string|Array):
// CHECK-NEXT: v1 = Data data=[[d_1]]
// CHECK-NEXT: v2 = IteratorOpen v0
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v4 = IteratorResume v2
// CHECK-NEXT: v5 = ResultAt v4
// CHECK-NEXT: v6 = ResultAt v4 index=1
// CHECK-NEXT: Branch v5 -> taken b2(), notTaken b3()
// CHECK-NEXT: b2():
// CHECK-NEXT: Return v1
// CHECK-NEXT: b3():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b5():
// CHECK-NEXT: v7 = PropGet v1 key="push"
// CHECK-NEXT: v8 = Call v7, v1, v6 calleeKey="push" calleeName="seen.push"
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b5() role=IterationCleanup subject=v2:
// CHECK-NEXT: v9 = CatchException
// CHECK-NEXT: IteratorClose v2 completion=Throw
// CHECK-NEXT: Rethrow v9
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="storesTheFirst"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array<undefined|null|string>):
// CHECK-NEXT: v1 = Integer
// CHECK-NEXT: v2 = String string="changed"
// CHECK-NEXT: ElemSet v0, v1, v2 mode=Sloppy
// CHECK-NEXT: v4 = Integer
// CHECK-NEXT: v5 = ElemGet v0, v4
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="addsAMember"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_2]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_2]]):
// CHECK-NEXT: v1 = Integer integer=1
// CHECK-NEXT: PropSet v0, v1 key="x" mode=Sloppy
// CHECK-NEXT: v3 = PropGet v0 key="x"
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
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
// CHECK-NEXT: v9 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v10 = Call v9, -, v1 calleeName="outcome"
// CHECK-NEXT: v11 = Add v8, v10
// CHECK-NEXT: v12 = Call v6, v4, v11 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="here"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsSloppy] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_4]]
// CHECK-NEXT: v1 = NewTemplateObject templateStrings=[{cooked="same place" raw="same place"}]
// CHECK-NEXT: v2 = Call v0, -, v1 calleeName="returnsIt"
// CHECK-NEXT: Return v2
// CHECK-NEXT: }
