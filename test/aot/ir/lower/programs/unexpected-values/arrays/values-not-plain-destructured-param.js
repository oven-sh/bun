// RUN: lower
// OPTIONS: builtin-modules

// Values that are not plain arrays are destructured in parameters and assignments.
function describe(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return value.length > 120 ? JSON.stringify(value.slice(0, 60)) + " and " + (value.length - 60) + " more characters" : JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const prototype = Object.getPrototypeOf(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    const property = Reflect.getOwnPropertyDescriptor(value, key);
    parts.push(String(key) + ": " + ("value" in property ? describe(property.value) : "accessor"));
  }
  if (value instanceof Set || value instanceof Map) for (const entry of value) parts.push(describe(entry));
  if (parts.length > 16) parts.splice(8, parts.length - 16, "and " + (parts.length - 16) + " more");
  const name = prototype === null ? "no prototype" : prototype.constructor.name;
  return name + (Array.isArray(value) ? " [" + parts.join(", ") + "]" : " {" + parts.join(", ") + "}");
}

function attempt(label, list, run) {
  try {
    console.log(label + ": " + describe(run(list)));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name + " and left " + describe(list));
  }
}

class Quiet extends Array {}

class Loud extends Array {
  *[Symbol.iterator]() {
    yield "the subclass's iterator";
  }
}

const ownMembers = {
  *[Symbol.iterator]() {
    yield "its own iterator";
  },
};

const otherPrototype = {
  __proto__: Array.prototype,
  *[Symbol.iterator]() {
    yield "the other prototype's iterator";
  },
};

const makers = {
  "a subclass": () => Quiet.of(3, 1, 2),
  "a subclass that overrides": () => Loud.of(3, 1, 2),
  "an array-like": () => ({ 0: 3, 1: 1, 2: 2, length: 3 }),
  "an array-like under Array.prototype": () => ({ __proto__: Array.prototype, 0: 3, 1: 1, 2: 2, length: 3 }),
  "an array with its own member": () => Object.assign([3, 1, 2], ownMembers),
  "an array under null": () => Object.setPrototypeOf([3, 1, 2], null),
  "an array under another prototype": () => Object.setPrototypeOf([3, 1, 2], otherPrototype),
  "a proxy": () => new Proxy([3, 1, 2], {}),
  "mapped arguments": () => (function (a, b, c) { return arguments; })(3, 1, 2),
  "unmapped arguments": () => (function () { "use strict"; return arguments; })(3, 1, 2),
  "a Uint8Array": () => new Uint8Array([3, 1, 2]),
  "a Float64Array": () => new Float64Array([3.5, 1, 2]),
  "a BigInt64Array": () => new BigInt64Array([3n, 1n, 2n]),
  "a string": () => "312",
  "a String object": () => new String("312"),
  "a Set": () => new Set([3, 1, 2]),
  "a Map": () => new Map([[3, "c"], [1, "a"], [2, "b"]]),
  "a generator": () => (function* () { yield 3; yield 1; yield 2; })(),
  "a frozen array": () => Object.freeze([3, 1, 2]),
  "a sealed array": () => Object.seal([3, 1, 2]),
  "a non-extensible array": () => Object.preventExtensions([3, 1, 2]),
  "an array with a hole": () => [3, , 2],
  "a hole over an inherited element": () => Object.setPrototypeOf([3, , 2], { __proto__: Array.prototype, 1: "inherited" }),
  "an array with a getter": () => Object.defineProperty([3, 1, 2], 1, { get() { return "got"; }, enumerable: true, configurable: true }),
  "an array with a fixed length": () => Object.defineProperty([3, 1, 2], "length", { writable: false }),
  "a sparse array": () => { const list = [3, 1, 2]; list[20000] = 4; return list; },
  "doubles": () => [3.5, 1.25, 2],
  "strings": () => ["c", "a", "b"],
  "mixed values": () => [3, "1", 2.5, null, undefined, { valueOf() { return 7; } }],
  "an empty array": () => [],
  "null": () => null,
  "undefined": () => undefined,
  "a number": () => 312,
  "a function": () => function (a, b, c) {},
  "an empty object": () => ({}),
  "an array": () => [3, 1, 2],
};

function inAParameter([a, b] = ["no a", "no b"]) {
  return [a, b];
}

function assigned(list) {
  let a = "old a";
  let b = "old b";
  [a, b] = list;
  return [a, b];
}

function intoMembers(list) {
  const target = { first: "old", rest: "old" };
  [target.first, ...target.rest] = list;
  return target;
}

function none(list) {
  const [] = list;
  return "nothing taken";
}

const uses = {
  "in a parameter": list => inAParameter(list),
  "assigned": list => assigned(list),
  "into members": list => intoMembers(list),
  "an empty pattern": list => none(list),
};

const honest = {};

function round(title) {
  for (const name in makers) {
    for (const use in uses) {
      attempt(title + ", " + use + ", " + name, makers[name](), uses[use]);
      if (Object.hasOwn(honest, use) && describe(uses[use]([3, 1, 2])) !== honest[use]) console.log("WRONG: an array after " + name + " in " + use);
    }
  }
}

round("at first");
for (const use in uses) {
  honest[use] = describe(uses[use]([3, 1, 2]));
  for (let i = 0; i < 2000; i++) uses[use]([3, 1, 2]);
}
round("after 2000 arrays");

module.exports = uses;

// GENERATED: attempt intoMembers Quiet
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|string flags=[IsExpected]}, {type=undefined|null|number|string|symbol|bigint|object flags=[IsExpected]}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string, v1: undefined|null|number|string|symbol|bigint|object, v2: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b2():
// CHECK-NEXT: v3 = Builtin builtin=GlobalThis
// CHECK-NEXT: v4 = PropGet v3 key="console" [isFreeName]
// CHECK-NEXT: v5 = Convert v4 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v6 = PropGet v5 key="log"
// CHECK-NEXT: v7 = Convert v6 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v8 = String string=": "
// CHECK-NEXT: v9 = Add v0, v8
// CHECK-NEXT: v10 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v11 = Call v2, -, v1 calleeName="run"
// CHECK-NEXT: v12 = Call v10, -, v11 calleeName="describe"
// CHECK-NEXT: v13 = Add v9, v12
// CHECK-NEXT: v14 = Call v7, v5, v13 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b2() role=CatchHandler:
// CHECK-NEXT: v15 = CatchValue
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v21 = String string=": threw "
// CHECK-NEXT: v22 = Add v0, v21
// CHECK-NEXT: v23 = PropGet v15 key="constructor"
// CHECK-NEXT: v24 = PropGet v23 key="name"
// CHECK-NEXT: v25 = Add v22, v24
// CHECK-NEXT: v26 = String string=" and left "
// CHECK-NEXT: v27 = Add v25, v26
// CHECK-NEXT: v28 = GetModuleVariable variable=[[g_1]]
// CHECK-NEXT: v29 = Call v28, -, v1 calleeName="describe"
// CHECK-NEXT: v30 = Add v27, v29
// CHECK-NEXT: v31 = Call v20, v18, v30 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3():
// CHECK-NEXT: v32 = Undefined
// CHECK-NEXT: Return v32
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="intoMembers"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|string|Array flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|string|Array):
// CHECK-NEXT: v1 = Data data=[[d_2]]
// CHECK-NEXT: v2 = IteratorOpen v0 elementCount=1 [isDestructuring, hasRest]
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1() handler=b6():
// CHECK-NEXT: v3 = IteratorResume v2 stepIndex=0
// CHECK-NEXT: v4 = ResultAt v3
// CHECK-NEXT: v5 = ResultAt v3 index=1
// CHECK-NEXT: PropSet v1, v5 key="first" mode=Sloppy
// CHECK-NEXT: v7 = NewArray contents=anything
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b6():
// CHECK-NEXT: LoopHint
// CHECK-NEXT: v9 = IteratorResume v2 stepIndex=1
// CHECK-NEXT: v10 = ResultAt v9
// CHECK-NEXT: v11 = ResultAt v9 index=1
// CHECK-NEXT: Branch v10 -> taken b3(), notTaken b5()
// CHECK-NEXT: b3() handler=b6():
// CHECK-NEXT: PropSet v1, v7 key="rest" mode=Sloppy
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: IteratorClose v2
// CHECK-NEXT: Return v1
// CHECK-NEXT: b5() handler=b6():
// CHECK-NEXT: AppendElement v7, v11
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b6() role=IterationCleanup subject=v2:
// CHECK-NEXT: v15 = CatchException
// CHECK-NEXT: IteratorClose v2 completion=Throw
// CHECK-NEXT: Rethrow v15
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Quiet"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_3]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_3]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
