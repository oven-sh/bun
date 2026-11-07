// RUN: lower
// OPTIONS: builtin-modules

// Many callers of a function with destructured parameters and an lookalikes.
function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "a function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) return "[" + Array.from(value, (item, i) => (i in value ? show(item) : "hole")).join(", ") + "]";
  return Object.prototype.toString.call(value).slice(8, -1) + " " + JSON.stringify(value);
}

const log = [];

function attempt(label, run) {
  log.length = 0;
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + ":", line + (log.length ? ", log " + log.join(" ") : ""));
}

function span({ x, y }) {
  return x - y;
}

function pair([a, b]) {
  return a + b;
}

function named({ name = "nobody", age: years = 0 } = {}) {
  return name + " " + years;
}

function inner({ at: { x, y } }) {
  return x * y;
}

function others({ a, ...rest }) {
  return a + " " + Object.keys(rest).join();
}

function headAndTail([head, ...tail]) {
  return head + " " + tail.length;
}

function honest(round) {
  console.log(round, "span", span({ x: 3, y: 1 }), span({ x: 0.5, y: 0.25 }), span({ x: -1, y: -1 }), span({ x: 9, y: 4 }), span({ x: 1, y: 2 }));
  console.log(round, "pair", pair([1, 2]), pair([0.5, 0.5]), pair([3, 4, 5]), pair(new Array(6, 7)), pair(Array.of(8, 9)));
  console.log(round, "named", named(), named({}), named({ name: "ann" }), named({ age: 3 }), named({ name: "bob", age: 4 }));
  console.log(round, "inner", inner({ at: { x: 2, y: 3 } }), inner({ at: { x: 0.5, y: 4 } }), inner({ at: { x: -1, y: 1 } }));
  console.log(round, "others", others({ a: 1, b: 2, c: 3 }), others({ a: 1 }), others({ b: 2, a: 1 }));
  console.log(round, "headAndTail", headAndTail([1, 2, 3]), headAndTail([1]), headAndTail([]), headAndTail(["a", "b"]));
}

const notObjects = [
  ["getters in the other order", () => ({ get y() { log.push("y"); return 1; }, get x() { log.push("x"); return 3; }, get a() { log.push("a"); return 1; } })],
  ["a proxy", () => new Proxy({ x: 3, y: 1, a: 1, b: 2 }, {
    get: (target, key) => (log.push("get " + String(key)), target[key]),
    ownKeys: target => (log.push("ownKeys"), Reflect.ownKeys(target)),
    getOwnPropertyDescriptor: (target, key) => (log.push("describe " + String(key)), Reflect.getOwnPropertyDescriptor(target, key)),
  })],
  ["members on the prototype", () => Object.create({ x: 3, y: 1, a: 1, name: "proto", age: 9, at: { x: 1, y: 1 } })],
  ["null members", () => ({ x: null, y: null, name: null, age: null, at: null, a: null })],
  ["undefined members", () => ({ x: undefined, y: undefined, name: undefined, age: undefined, at: undefined, a: undefined })],
  ["an array", () => [3, 1]],
  ["a string", () => "xy"],
  ["a number", () => 5],
  ["a function", () => function name() {}],
  ["null", () => null],
  ["undefined", () => undefined],
];

const notArrays = [
  ["a string", () => "ab"],
  ["a Set", () => new Set([1, 2, 3])],
  ["a Map", () => new Map([[1, 2], [3, 4]])],
  ["a generator that says when it is closed", () => (function* () { try { yield 1; yield 2; yield 3; } finally { log.push("closed"); } })()],
  ["an array with its own iterator", () => Object.assign([1, 2], { [Symbol.iterator]: () => (log.push("asked"), [7, 8][Symbol.iterator]()) })],
  ["holes", () => new Array(2)],
  ["a typed array", () => new Uint8Array([250, 10])],
  ["an arguments object", () => (function () { return arguments; })(1, 2)],
  ["an array-like object", () => ({ 0: 1, 1: 2, length: 2 })],
  ["a number", () => 5],
  ["null", () => null],
];

honest("before");
for (const [name, make] of notObjects) {
  attempt("span of " + name, () => span(make()));
  attempt("named of " + name, () => named(make()));
  attempt("inner of " + name, () => inner(make()));
  attempt("others of " + name, () => others(make()));
  attempt("span through call of " + name, () => span.call(null, make()));
  attempt("named as a callback of " + name, () => [make()].map(named)[0]);
}
for (const [name, make] of notArrays) {
  attempt("pair of " + name, () => pair(make()));
  attempt("headAndTail of " + name, () => headAndTail(make()));
  attempt("pair through apply of " + name, () => pair.apply(null, [make()]));
  attempt("headAndTail from hidden code of " + name, () => new Function("f", "value", "return f(value)")(headAndTail, make()));
}
honest("after");

// GENERATED: others headAndTail [Symbol.iterator]
// CHECK-LABEL: function {{*}}name="others"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_1]]):
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b1(| 0), notTaken b2(| 0)
// CHECK-NEXT: b1(v2):
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=NotDestructurable name="a"
// CHECK-NEXT: Throw v3
// CHECK-NEXT: b2(v4):
// CHECK-NEXT: v5 = PropGet v4 key="a"
// CHECK-NEXT: v6 = CopyObject v4 excludedKeys=["a"]
// CHECK-NEXT: v7 = String string=" "
// CHECK-NEXT: v8 = Add v5, v7
// CHECK-NEXT: v9 = Builtin builtin=Object
// CHECK-NEXT: v10 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v11 = Call v10, v9, v6 calleeName="Object.keys"
// CHECK-NEXT: v12 = PropGet v11 key="join"
// CHECK-NEXT: v13 = Call v12, v11 calleeKey="join" calleeName="join"
// CHECK-NEXT: v14 = Add v8, v13
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="headAndTail"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|Array):
// CHECK-NEXT: v1 = IteratorOpen v0 elementCount=1 [isDestructuring, hasRest]
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b6():
// CHECK-NEXT: v2 = IteratorResume v1 stepIndex=0
// CHECK-NEXT: v3 = ResultAt v2
// CHECK-NEXT: v4 = ResultAt v2 index=1
// CHECK-NEXT: v5 = NewArray contents=anything
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b6():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = IteratorResume v1 stepIndex=1
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: Branch v8 -> taken b3(), notTaken b5()
// CHECK-NEXT: b3() handler=b6():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: IteratorClose v1
// CHECK-NEXT: v11 = String string=" "
// CHECK-NEXT: v12 = Add v4, v11
// CHECK-NEXT: v13 = PropGet v5 key="length"
// CHECK-NEXT: v14 = Add v12, v13
// CHECK-NEXT: Return v14
// CHECK-NEXT: b5() handler=b6():
// CHECK-NEXT: AppendElement v5, v9
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b6() role=IterationCleanup subject=v1:
// CHECK-NEXT: v16 = CatchException
// CHECK-NEXT: IteratorClose v1 completion=Throw
// CHECK-NEXT: Rethrow v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsNamedByComputedKey] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_2]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="log"
// CHECK-NEXT: v2 = PropGet v1 key="push"
// CHECK-NEXT: v3 = String string="asked"
// CHECK-NEXT: v4 = Call v2, v1, v3 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v5 = Data data=[[d_3]]
// CHECK-NEXT: v6 = PropGet v5 key=@@iterator
// CHECK-NEXT: v7 = Call v6, v5 calleeKey=@@iterator
// CHECK-NEXT: ReturnCall v7
// CHECK-NEXT: }
