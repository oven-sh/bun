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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|number|string|symbol|bigint|[[L_1]] flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|number|string|symbol|bigint|[[L_1]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = TypeTest v0 testedType=undefined|null
// CHECK-NEXT: Branch v1 -> taken b2(| 0), notTaken b4(| 0)
// CHECK-NEXT: b2(v2):
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() frequency=Unlikely:
// CHECK-NEXT: v3 = NewRuntimeError runtimeError=NotDestructurable name="a"
// CHECK-NEXT: Throw v3
// CHECK-NEXT: b4(v4):
// CHECK-NEXT: v5 = PropGet v4 key="a"
// CHECK-NEXT: v6 = NewObject layout=[[L_2]]
// CHECK-NEXT: CopyDataProperties v6, v4 excludedKeys=["a"]
// CHECK-NEXT: v8 = FinishObject v6
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: v10 = String string=" "
// CHECK-NEXT: v11 = Add v5, v10
// CHECK-NEXT: v12 = Builtin builtin=Object
// CHECK-NEXT: v13 = Builtin builtin=ObjectKeys
// CHECK-NEXT: v14 = Call v13, v12, v9 calleeName="Object.keys"
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|Array<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v16 = PropGet v15 key="join"
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v18 = Call v17, v15 calleeKey="join" calleeName="join"
// CHECK-NEXT: v19 = Convert v18 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v20 = Add v11, v19
// CHECK-NEXT: v21 = Convert v20 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v21
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="headAndTail"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|Array flags=[IsExpected]}] results=[{type=undefined|null|string flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = IteratorOpen v0 elementCount=1 [isDestructuring, hasRest]
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b10():
// CHECK-NEXT: v2 = IteratorResume v1 stepIndex=0
// CHECK-NEXT: v3 = ResultAt v2
// CHECK-NEXT: v4 = ResultAt v2 index=1
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b10():
// CHECK-NEXT: v5 = NewArray contents=anything
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4() handler=b10():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v7 = IteratorResume v1 stepIndex=1
// CHECK-NEXT: v8 = ResultAt v7
// CHECK-NEXT: v9 = ResultAt v7 index=1
// CHECK-NEXT: Branch v8 -> taken b5(), notTaken b9()
// CHECK-NEXT: b5() handler=b10():
// CHECK-NEXT: v10 = Convert v5 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b6()
// CHECK-NEXT: b6() handler=b10():
// CHECK-NEXT: Jump -> next b7()
// CHECK-NEXT: b7():
// CHECK-NEXT: IteratorClose v1
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v12 = String string=" "
// CHECK-NEXT: v13 = Add v4, v12
// CHECK-NEXT: v14 = PropGet v10 key="length"
// CHECK-NEXT: v15 = Convert v14 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v16 = Add v13, v15
// CHECK-NEXT: v17 = Convert v16 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Return v17
// CHECK-NEXT: b9() handler=b10():
// CHECK-NEXT: AppendElement v5, v9
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b10() role=IterationCleanup subject=v1:
// CHECK-NEXT: v19 = CatchException
// CHECK-NEXT: IteratorClose v1 completion=Throw
// CHECK-NEXT: Rethrow v19
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Arrow flags=[IsNamedByComputedKey] thisType={type=anything} results=[{type=undefined|null|[[L_4]]|Generator flags=[IsExpected]}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_5]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="log"
// CHECK-NEXT: v2 = PropGet v1 key="push"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: v4 = String string="asked"
// CHECK-NEXT: v5 = Call v3, v1, v4 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v6 = Data data=[[d_7]]
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|Array<number> flags=[IsExpected]}
// CHECK-NEXT: v8 = PropGet v7 key=@@iterator
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: v10 = Call v9, v7 calleeKey=@@iterator
// CHECK-NEXT: ReturnCall v10 casts=[{declared={type=undefined|null|[[L_4]]|Generator flags=[IsExpected]}}]
// CHECK-NEXT: }
