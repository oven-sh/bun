// RUN: lower
// OPTIONS: builtin-modules

// Await of thenables that do not keep to the rules.
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

async function outcome(run) {
  log.length = 0;
  try {
    const value = await run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

async function attempt(label, run) {
  console.log(label + " -> " + (await outcome(run)));
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

console.log("strict:", (function () { return this === undefined; })());

async function addsOne(thenable) {
  const n = await thenable;
  return [n + 1];
}
async function addsMembers(thenable) {
  const o = await thenable;
  return [o.x + o.y];
}

const thenables = [
  ["a promise", value => Promise.resolve(value)],
  ["a thenable", value => ({ then(resolve) { log.push("then"); resolve(value); } })],
  ["then is a getter", value => ({ get then() { log.push("get then"); return resolve => resolve(value); } })],
  ["then is a getter that throws", () => ({ get then() { log.push("get then"); throw new EvalError("in the getter"); } })],
  ["then is no function", value => ({ then: value })],
  ["then resolves twice", value => ({ then(resolve) { resolve(value); resolve("second"); } })],
  ["then resolves and rejects", value => ({ then(resolve, reject) { resolve(value); reject(new EvalError("late")); } })],
  ["then resolves and throws", value => ({ then(resolve) { resolve(value); throw new EvalError("late"); } })],
  ["then throws", () => ({ then() { throw new EvalError("in then"); } })],
  ["then resolves with another thenable", value => ({ then(resolve) { log.push("outer then"); resolve({ then(inner) { log.push("inner then"); inner(value); } }); } })],
  ["then resolves later", value => ({ then(resolve) { setTimeout(resolve, 0, value); } })],
  ["then is inherited", value => Object.create({ then(resolve) { log.push("inherited then"); resolve(value); } })],
  ["a proxy of a promise", value => new Proxy(Promise.resolve(value), {})],
  ["a proxy of a thenable", value => logged({ then(resolve) { resolve(value); } })],
  ["a function with then", value => Object.assign(() => {}, { then(resolve) { resolve(value); } })],
  ["a promise with its own then", value => Object.assign(Promise.resolve("ignored"), { then(resolve) { log.push("own then"); resolve(value); } })],
  ["a promise whose constructor is another", value => Object.assign(Promise.resolve(value), { constructor: Object })],
  ["an instance of a subclass with its own then", value => new (class extends Promise { then(resolve, reject) { log.push("subclass then"); return super.then(resolve, reject); } })(resolve => resolve(value))],
];
const numbers = [["an integer", () => 7], ["a text", () => "3"], ["an object with valueOf", () => ({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; } })], ["undefined", () => undefined]];
const objects = [["an object", () => ({ x: 1, y: 2 })], ["accessors", () => ({ get x() { log.push("get x"); return 10; }, get y() { log.push("get y"); return 20; } })], ["null", () => null]];

async function main() {
  for (let i = 0; i < 1000; i++) {
    await addsOne(Promise.resolve(7));
    await addsMembers(Promise.resolve({ x: 1, y: 2 }));
  }
  for (const [label, wrap] of [...thenables, thenables[0]]) {
    for (const [kind, make] of numbers) await attempt("addsOne, " + label + " hands over " + kind, () => addsOne(wrap(make())));
    for (const [kind, make] of objects) await attempt("addsMembers, " + label + " hands over " + kind, () => addsMembers(wrap(make())));
  }
}
main();

// GENERATED: logged addsOne get set apply
// CHECK-LABEL: function {{*}}name="logged"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 thisType={type=anything} parameters=[{type=undefined|null|[[L_1]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[L_1]]):
// CHECK-NEXT: v1 = Builtin builtin=Proxy
// CHECK-NEXT: v2 = NewClosure function=[[f_2]]
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|[[f_3]] flags=[IsExpected]}
// CHECK-NEXT: v4 = NewObject layout=[[L_4]]
// CHECK-NEXT: PropDefine v4, v3 key="get"
// CHECK-NEXT: v6 = NewClosure function=[[f_5]]
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[f_6]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v4, v7 key="set"
// CHECK-NEXT: v9 = NewClosure function=[[f_7]]
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[f_8]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v4, v10 key="apply"
// CHECK-NEXT: v12 = FinishObject v4
// CHECK-NEXT: v13 = Construct v1, -, v0, v12 calleeName="Proxy"
// CHECK-NEXT: Return v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="addsOne"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] length=1 syntax=[HasWrittenAwait] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: v2 = Await v1, v1
// CHECK-NEXT: v3 = Integer integer=1
// CHECK-NEXT: v4 = Add v2, v3
// CHECK-NEXT: v5 = NewArray v4 contents=anything
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=3 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|string|symbol flags=[IsExpected]}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string|symbol, v2: anything):
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="log"
// CHECK-NEXT: v5 = PropGet v4 key="push"
// CHECK-NEXT: v6 = String string="get "
// CHECK-NEXT: v7 = Builtin builtin=String
// CHECK-NEXT: v8 = Call v7, -, v1 calleeName="String"
// CHECK-NEXT: v9 = Add v6, v8
// CHECK-NEXT: v10 = Call v5, v4, v9 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v11 = Builtin builtin=Reflect
// CHECK-NEXT: v12 = Builtin builtin=ReflectGet
// CHECK-NEXT: v13 = Call v12, v11, v0, v1, v2 calleeName="Reflect.get"
// CHECK-NEXT: ReturnCall v13
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=4 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|string|symbol flags=[IsExpected]}, {type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|string|symbol, v2: anything, v3: anything):
// CHECK-NEXT: v4 = GetModuleVariable variable=[[g_9]]
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
// CHECK-LABEL: function {{*}}name="apply"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=3 thisType={type=anything} parameters=[{type=undefined|null|[[f_10]] flags=[IsExpected]}, {type=anything}, {type=undefined|null|Array flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: undefined|null|[[f_10]], v1: anything, v2: undefined|null|Array):
// CHECK-NEXT: v3 = GetModuleVariable variable=[[g_9]]
// CHECK-NEXT: v4 = CheckInitialized v3 name="log"
// CHECK-NEXT: v5 = PropGet v4 key="push"
// CHECK-NEXT: v6 = String string="apply "
// CHECK-NEXT: v7 = PropGet v2 key="length"
// CHECK-NEXT: v8 = Add v6, v7
// CHECK-NEXT: v9 = Call v5, v4, v8 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v10 = Builtin builtin=Reflect
// CHECK-NEXT: v11 = Builtin builtin=ReflectApply
// CHECK-NEXT: v12 = Call v11, v10, v0, v1, v2 calleeName="Reflect.apply"
// CHECK-NEXT: ReturnCall v12
// CHECK-NEXT: }
