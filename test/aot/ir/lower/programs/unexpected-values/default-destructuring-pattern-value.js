// RUN: lower
// OPTIONS: builtin-modules

// A default in a destructuring pattern hands over the value.
"use strict";

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

class Odd extends Array {
  push(value) {
    log.push("Odd.push " + value);
    return 42;
  }
  *[Symbol.iterator]() {
    log.push("Odd.iterator");
    yield "odd";
  }
}

function logged(target) {
  return new Proxy(target, {
    get(target, key, receiver) {
      log.push("get " + String(key));
      return Reflect.get(target, key, receiver);
    },
    set(target, key, value, receiver) {
      log.push("set " + String(key));
      return Reflect.set(target, key, value, receiver);
    },
    apply(target, self, list) {
      log.push("apply " + list.length);
      return Reflect.apply(target, self, list);
    },
  });
}

const arrays = [
  ["an array", () => [5, 6]],
  ["a subclass", () => Odd.of(5, 6)],
  ["an array-like", () => ({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })],
  ["a proxy", () => logged([5, 6])],
  ["a frozen array", () => Object.freeze([5, 6])],
  ["a string", () => "ab"],
];

const strings = [
  ["a string", () => "abc"],
  ["an object with charCodeAt", () => ({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } })],
  ["a String object with its own charCodeAt", () => Object.assign(new String("xyz"), { charCodeAt: () => -1 })],
  ["an array", () => ["abc"]],
  ["a number", () => 65],
];

const numbers = [
  ["an integer", () => 7],
  ["a string", () => "3"],
  ["an object with valueOf", () => ({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })],
  ["a bigint", () => 10n],
  ["the largest int32", () => 2147483647],
  ["minus zero", () => -0],
  ["undefined", () => undefined],
];

const functions = [
  ["a function", () => x => x + 1],
  ["a class", () => class Made { constructor(x) { log.push("constructed " + x); } }],
  ["a callable proxy", () => logged(x => x + 2)],
  ["a bound function", () => function (a, b) { return [this.tag, a, b]; }.bind({ tag: "bound" }, "first")],
  ["an object with call", () => ({ call() { log.push("call"); return "called"; } })],
];

const objects = [
  ["an object", () => ({ x: 1, y: 2 })],
  ["accessors", () => ({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })],
  ["a proxy", () => logged({ y: 2, x: 1 })],
  ["a frozen object", () => Object.freeze({ x: 5, y: 6 })],
  ["texts in another order", () => ({ y: "2", x: "1" })],
  ["inherited members", () => Object.create({ x: 3, y: 4 })],
];

function pushes(source, { value: a = source() } = {}) {
  a.push(1);
  return a.length;
}

function iterates(source, { value: a = source() } = {}) {
  const seen = [];
  for (const x of a) seen.push(x);
  return seen;
}

function readsCharCode(source, { value: s = source() } = {}) {
  return s.charCodeAt(0);
}

function truncates(source, { value: n = source() } = {}) {
  return n | 0;
}

function addsOne(source, { value: n = source() } = {}) {
  return n + 1;
}

function calls(source, { value: f = source() } = {}) {
  return f(1);
}

function addsMembers(source, { value: o = source() } = {}) {
  return o.x + o.y;
}

function storesMember(source, { value: o = source() } = {}) {
  o.x = 1;
  return o;
}

const table = [
  ["pushes", pushes, arrays],
  ["iterates", iterates, arrays],
  ["readsCharCode", readsCharCode, strings],
  ["truncates", truncates, numbers],
  ["addsOne", addsOne, numbers],
  ["calls", calls, functions],
  ["addsMembers", addsMembers, objects],
  ["storesMember", storesMember, objects],
];

function everyCase(round) {
  for (const [name, use, values] of table) {
    for (const [label, make] of [...values, values[0]]) attempt(round + " " + name + " " + label, () => use(() => make()));
  }
}

console.log("strict:", (function () { return this === undefined; })());
everyCase("at first");
for (let i = 0; i < 2000; i++) {
  pushes(() => [5, 6]);
  iterates(() => [5, 6]);
  readsCharCode(() => "abc");
  truncates(() => 7);
  addsOne(() => 7);
  calls(() => x => x + 1);
  addsMembers(() => ({ x: 1, y: 2 }));
  storesMember(() => ({ x: 1, y: 2 }));
}
everyCase("after 2000");

// GENERATED: logged Odd [Symbol.iterator] set
// CHECK-LABEL: function {{*}}name="logged"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|[[L_2]]|[[f_3]]|Array<number> flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: undefined|null|[[L_2]]|[[f_3]]|Array<number>):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=Proxy
// CHECK-NEXT: v3 = NewClosure v0 function=[[f_4]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_5]] flags=[IsExpected]}
// CHECK-NEXT: v5 = NewObject layout=[[L_6]]
// CHECK-NEXT: PropDefine v5, v4 key="get"
// CHECK-NEXT: v7 = NewClosure v0 function=[[f_7]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v5, v8 key="set"
// CHECK-NEXT: v10 = NewClosure v0 function=[[f_9]]
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_10]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v5, v11 key="apply"
// CHECK-NEXT: v13 = FinishObject v5
// CHECK-NEXT: v14 = Construct v2, -, v1, v13 calleeName="Proxy"
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Odd"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_11]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_11]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsGenerator, HasThis, TakesCallee, IsNamedByComputedKey] captures=[{type=undefined|null|Array flags=[IsExpected]}] thisType={type=[[L_11]] flags=[IsExpected]} results=[{type=undefined|null|Generator<undefined|null|string> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array, v1: [[L_11]], v2: function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v4 = PropGet v0 key="push"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|[[f_12]] flags=[IsExpected]}
// CHECK-NEXT: v6 = String string="Odd.iterator"
// CHECK-NEXT: v7 = Call v5, v0, v6 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v8 = String string="odd"
// CHECK-NEXT: v9 = Convert v8 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v10 = Yield v9
// CHECK-NEXT: v11 = ResultAt v10
// CHECK-NEXT: v12 = ResultAt v10 index=1
// CHECK-NEXT: Switch v12 cases=[1, 2] -> case b2(), case b3(), otherwise b4()
// CHECK-NEXT: b2():
// CHECK-NEXT: Throw v11
// CHECK-NEXT: b3():
// CHECK-NEXT: Return v11
// CHECK-NEXT: b4():
// CHECK-NEXT: v13 = Undefined
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=4 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|string|symbol flags=[IsExpected]}, {type=anything}, {type=anything}] results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_13]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything, v2: undefined|null|string|symbol, v3: anything, v4: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = GetEnvironmentField v0 layout=[[L_1]] field=3
// CHECK-NEXT: v6 = CheckInitialized v5 name="log"
// CHECK-NEXT: v7 = PropGet v6 key="push"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_12]] flags=[IsExpected]}
// CHECK-NEXT: v9 = String string="set "
// CHECK-NEXT: v10 = Builtin builtin=String
// CHECK-NEXT: v11 = Call v10, -, v2 calleeName="String"
// CHECK-NEXT: v12 = Convert v11 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v13 = Add v9, v12
// CHECK-NEXT: v14 = Call v8, v6, v13 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v15 = Builtin builtin=Reflect
// CHECK-NEXT: v16 = Builtin builtin=ReflectSet
// CHECK-NEXT: v17 = Call v16, v15, v1, v2, v3, v4 calleeName="Reflect.set"
// CHECK-NEXT: ReturnCall v17 casts=[{declared={type=boolean flags=[IsExpected]}}]
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsNamedByComputedKey] captures=[{type=undefined|null|Array flags=[IsExpected]}] thisType={type=anything} results=[{type=undefined|null|[[L_14]]|Generator flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: undefined|null|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v1 = PropGet v0 key="push"
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|[[f_12]] flags=[IsExpected]}
// CHECK-NEXT: v3 = String string="own iterator"
// CHECK-NEXT: v4 = Call v2, v0, v3 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v5 = Data data=[[d_15]]
// CHECK-NEXT: v6 = Convert v5 declared={type=undefined|null|Array<number> flags=[IsExpected]}
// CHECK-NEXT: v7 = PropGet v6 key=@@iterator
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_16]] flags=[IsExpected]}
// CHECK-NEXT: v9 = Call v8, v6 calleeKey=@@iterator
// CHECK-NEXT: ReturnCall v9 casts=[{declared={type=undefined|null|[[L_14]]|Generator flags=[IsExpected]}}]
// CHECK-NEXT: }
