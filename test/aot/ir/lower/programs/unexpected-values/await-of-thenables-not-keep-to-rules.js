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
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[HasExplicitName] length=1 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|[[L_2]] flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: undefined|null|[[L_2]]):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Builtin builtin=Proxy
// CHECK-NEXT: v3 = NewClosure v0 function=[[f_3]]
// CHECK-NEXT: v4 = Convert v3 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v5 = NewObject layout=[[L_5]]
// CHECK-NEXT: PropDefine v5, v4 key="get"
// CHECK-NEXT: v7 = NewClosure v0 function=[[f_6]]
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_7]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v5, v8 key="set"
// CHECK-NEXT: v10 = NewClosure v0 function=[[f_8]]
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|[[f_9]] flags=[IsExpected]}
// CHECK-NEXT: PropDefine v5, v11 key="apply"
// CHECK-NEXT: v13 = FinishObject v5
// CHECK-NEXT: v14 = Construct v2, -, v1, v13 calleeName="Proxy"
// CHECK-NEXT: Return v14
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="addsOne"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, HasThis, HasExplicitName] length=1 thisType={type=anything} parameters=[{type=anything}] results=[{type=undefined|null|Promise<undefined|null|Array> flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: anything, v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Await v1, v1
// CHECK-NEXT: v3 = Convert v2 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = Add v3, v4
// CHECK-NEXT: v6 = NewArray v5 contents=anything
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|Array flags=[IsExpected]}
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|object flags=[IsExpected]}
// CHECK-NEXT: Return v8
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="get"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=3 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|string|symbol flags=[IsExpected]}, {type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_10]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything, v2: undefined|null|string|symbol, v3: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = GetEnvironmentField v0 layout=[[L_1]] field=5
// CHECK-NEXT: v5 = CheckInitialized v4 name="log"
// CHECK-NEXT: v6 = PropGet v5 key="push"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[f_11]] flags=[IsExpected]}
// CHECK-NEXT: v8 = String string="get "
// CHECK-NEXT: v9 = Builtin builtin=String
// CHECK-NEXT: v10 = Call v9, -, v2 calleeName="String"
// CHECK-NEXT: v11 = Convert v10 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v12 = Add v8, v11
// CHECK-NEXT: v13 = Call v7, v5, v12 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v14 = Builtin builtin=Reflect
// CHECK-NEXT: v15 = Builtin builtin=ReflectGet
// CHECK-NEXT: v16 = Call v15, v14, v1, v2, v3 calleeName="Reflect.get"
// CHECK-NEXT: ReturnCall v16
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="set"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=4 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|string|symbol flags=[IsExpected]}, {type=anything}, {type=anything}] results=[{type=boolean flags=[IsExpected]}] functionTypes={{*}}[[f_12]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything, v2: undefined|null|string|symbol, v3: anything, v4: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v5 = GetEnvironmentField v0 layout=[[L_1]] field=5
// CHECK-NEXT: v6 = CheckInitialized v5 name="log"
// CHECK-NEXT: v7 = PropGet v6 key="push"
// CHECK-NEXT: v8 = Convert v7 declared={type=undefined|null|[[f_11]] flags=[IsExpected]}
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
// CHECK-LABEL: function {{*}}name="apply"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=Method flags=[HasExplicitName] length=3 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=undefined|null|[[f_13]] flags=[IsExpected]}, {type=anything}, {type=undefined|null|Array flags=[IsExpected]}] results=[{type=anything}] functionTypes={{*}}[[f_14]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: undefined|null|[[f_13]], v2: anything, v3: undefined|null|Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = GetEnvironmentField v0 layout=[[L_1]] field=5
// CHECK-NEXT: v5 = CheckInitialized v4 name="log"
// CHECK-NEXT: v6 = PropGet v5 key="push"
// CHECK-NEXT: v7 = Convert v6 declared={type=undefined|null|[[f_11]] flags=[IsExpected]}
// CHECK-NEXT: v8 = String string="apply "
// CHECK-NEXT: v9 = PropGet v3 key="length"
// CHECK-NEXT: v10 = Convert v9 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: v11 = Add v8, v10
// CHECK-NEXT: v12 = Call v7, v5, v11 calleeKey="push" calleeName="log.push"
// CHECK-NEXT: v13 = Builtin builtin=Reflect
// CHECK-NEXT: v14 = Builtin builtin=ReflectApply
// CHECK-NEXT: v15 = Call v14, v13, v1, v2, v3 calleeName="Reflect.apply"
// CHECK-NEXT: ReturnCall v15
// CHECK-NEXT: }
