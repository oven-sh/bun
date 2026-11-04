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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]]|[[f_2]]|Array<number> flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]|[[f_2]]|Array<number>):
// CHECK-NEXT: v1 = Builtin builtin=Proxy
// CHECK-NEXT: v2 = NewClosure function=[[f_3]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v4 = NewObject layout=[[L_5]]
// CHECK-NEXT: PropDefine v4, v3 key="get"
// CHECK-NEXT: v6 = NewClosure function=[[f_6]]
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v4, v7 key="set"
// CHECK-NEXT: v9 = NewClosure function=[[f_8]]
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[f_9]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v4, v10 key="apply"
// CHECK-NEXT: v12 = FinishObject v4
// CHECK-NEXT: v13 = Construct v1, -, v0, v12 calleeName="Proxy"
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Odd"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_10]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_10]]}
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsGenerator, HasThis, TakesCallee, IsNamedByComputedKey] thisType={type=[[L_10]] flags=[IsExpected]} results=[{type=anything}] {
// CHECK-NEXT: b0(v0: [[L_10]], v1: function):
// CHECK-NEXT: InitialYield
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="log"
// CHECK-NEXT: v5 = PropGet v4 key="push"
// CHECK-NEXT: v6 = String string="Odd.iterator"
// CHECK-NEXT: v7 = Call v5, v4, v6 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v8 = String string="odd"
// CHECK-NEXT: v9 = Yield v8
// CHECK-NEXT: v10 = ResultAt v9
// CHECK-NEXT: v11 = ResultAt v9 index=1
// CHECK-NEXT: Switch v11 cases=[1, 2] -> case b1(), case b2(), otherwise b3()
// CHECK-NEXT: b1():
// CHECK-NEXT: Throw v10
// CHECK-NEXT: b2():
// CHECK-NEXT: Return v10
// CHECK-NEXT: b3():
// CHECK-NEXT: v12 = Undefined
// CHECK-NEXT: Return v12
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=4 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|string|symbol flags=[IsExpected]}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string|symbol, v2: anything, v3: anything):
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v5 = CheckInitialized v4 name="log"
// CHECK-NEXT: v6 = PropGet v5 key="push"
// CHECK-NEXT: v7 = String string="set "
// CHECK-NEXT: v8 = Builtin builtin=String
// CHECK-NEXT: v9 = Call v8, -, v1 calleeName="String"
// CHECK-NEXT: v10 = Add v7, v9
// CHECK-NEXT: v11 = Call v6, v5, v10 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v12 = Builtin builtin=Reflect
// CHECK-NEXT: v13 = Builtin builtin=ReflectSet
// CHECK-NEXT: v14 = Call v13, v12, v0, v1, v2, v3 calleeName="Reflect.set"
// CHECK-NEXT: ReturnCall v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="[Symbol.iterator]"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[IsNamedByComputedKey] thisType={type=anything} results=[{type=anything}] {
// CHECK-NEXT: b0():
// CHECK-NEXT: v0 = GetModuleVariable variable=[[g_11]]
// CHECK-NEXT: v1 = CheckInitialized v0 name="log"
// CHECK-NEXT: v2 = PropGet v1 key="push"
// CHECK-NEXT: v3 = String string="own iterator"
// CHECK-NEXT: v4 = Call v2, v1, v3 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v5 = Data data=[[d_12]]
// CHECK-NEXT: v6 = PropGet v5 key=@@iterator
// CHECK-NEXT: v7 = Call v6, v5 calleeKey=@@iterator
// CHECK-NEXT: ReturnCall v7
// CHECK-NEXT: }
