// RUN: lower
// OPTIONS: builtin-modules

// Built ins hand something else later to a function whose visible callers pass an array.
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

const results = [];
async function observe(label, run) {
  results.length = 0;
  const end = await outcome(async () => void (await run()));
  console.log(label + " -> " + show(results) + " " + end);
}

function pushes1(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes2(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes3(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes4(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes5(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes6(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes7(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes8(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes9(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes10(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

function pushes11(a) {
  a.push(1);
  const result = a.length;
  results.push(result);
  return result;
}

async function main() {
  console.log("strict:", (function () { return this === undefined; })());

  pushes1([5, 6]);
  pushes1([5, 6]);
  await observe("then: an array", () => Promise.resolve(([5, 6])).then(pushes1));
  await observe("then: an array-like", () => Promise.resolve((({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))).then(pushes1));
  await observe("then: a subclass", () => Promise.resolve((Odd.of(5, 6))).then(pushes1));
  await observe("then: an array again", () => Promise.resolve(([5, 6])).then(pushes1));

  pushes2([5, 6]);
  pushes2([5, 6]);
  await observe("catch: an array", () => Promise.reject(([5, 6])).catch(pushes2));
  await observe("catch: an array-like", () => Promise.reject((({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))).catch(pushes2));
  await observe("catch: a subclass", () => Promise.reject((Odd.of(5, 6))).catch(pushes2));
  await observe("catch: an array again", () => Promise.reject(([5, 6])).catch(pushes2));

  pushes3([5, 6]);
  pushes3([5, 6]);
  await observe("the second function of then: an array", () => Promise.reject(([5, 6])).then(undefined, pushes3));
  await observe("the second function of then: an array-like", () => Promise.reject((({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))).then(undefined, pushes3));
  await observe("the second function of then: a subclass", () => Promise.reject((Odd.of(5, 6))).then(undefined, pushes3));
  await observe("the second function of then: an array again", () => Promise.reject(([5, 6])).then(undefined, pushes3));

  pushes4([5, 6]);
  pushes4([5, 6]);
  await observe("then of a promise resolved later: an array", () => new Promise(resolve => setTimeout(resolve, 0, ([5, 6]))).then(pushes4));
  await observe("then of a promise resolved later: an array-like", () => new Promise(resolve => setTimeout(resolve, 0, (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })))).then(pushes4));
  await observe("then of a promise resolved later: a subclass", () => new Promise(resolve => setTimeout(resolve, 0, (Odd.of(5, 6)))).then(pushes4));
  await observe("then of a promise resolved later: an array again", () => new Promise(resolve => setTimeout(resolve, 0, ([5, 6]))).then(pushes4));

  pushes5([5, 6]);
  pushes5([5, 6]);
  await observe("then of a thenable's value: an array", () => Promise.resolve({ then(resolve) { resolve(([5, 6])); } }).then(pushes5));
  await observe("then of a thenable's value: an array-like", () => Promise.resolve({ then(resolve) { resolve((({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))); } }).then(pushes5));
  await observe("then of a thenable's value: a subclass", () => Promise.resolve({ then(resolve) { resolve((Odd.of(5, 6))); } }).then(pushes5));
  await observe("then of a thenable's value: an array again", () => Promise.resolve({ then(resolve) { resolve(([5, 6])); } }).then(pushes5));

  pushes6([5, 6]);
  pushes6([5, 6]);
  await observe("Promise.try: an array", () => Promise.try(pushes6, ([5, 6])));
  await observe("Promise.try: an array-like", () => Promise.try(pushes6, (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))));
  await observe("Promise.try: a subclass", () => Promise.try(pushes6, (Odd.of(5, 6))));
  await observe("Promise.try: an array again", () => Promise.try(pushes6, ([5, 6])));

  pushes7([5, 6]);
  pushes7([5, 6]);
  await observe("Array.fromAsync: an array", () => Array.fromAsync([([5, 6])], pushes7));
  await observe("Array.fromAsync: an array-like", () => Array.fromAsync([(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))], pushes7));
  await observe("Array.fromAsync: a subclass", () => Array.fromAsync([(Odd.of(5, 6))], pushes7));
  await observe("Array.fromAsync: an array again", () => Array.fromAsync([([5, 6])], pushes7));

  pushes8([5, 6]);
  pushes8([5, 6]);
  await observe("setTimeout: an array", () => new Promise(resolve => { setTimeout(pushes8, 0, ([5, 6])); setTimeout(resolve, 1); }));
  await observe("setTimeout: an array-like", () => new Promise(resolve => { setTimeout(pushes8, 0, (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))); setTimeout(resolve, 1); }));
  await observe("setTimeout: a subclass", () => new Promise(resolve => { setTimeout(pushes8, 0, (Odd.of(5, 6))); setTimeout(resolve, 1); }));
  await observe("setTimeout: an array again", () => new Promise(resolve => { setTimeout(pushes8, 0, ([5, 6])); setTimeout(resolve, 1); }));

  pushes9([5, 6]);
  pushes9([5, 6]);
  await observe("setImmediate: an array", () => new Promise(resolve => { setImmediate(pushes9, ([5, 6])); setImmediate(resolve); }));
  await observe("setImmediate: an array-like", () => new Promise(resolve => { setImmediate(pushes9, (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))); setImmediate(resolve); }));
  await observe("setImmediate: a subclass", () => new Promise(resolve => { setImmediate(pushes9, (Odd.of(5, 6))); setImmediate(resolve); }));
  await observe("setImmediate: an array again", () => new Promise(resolve => { setImmediate(pushes9, ([5, 6])); setImmediate(resolve); }));

  pushes10([5, 6]);
  pushes10([5, 6]);
  await observe("process.nextTick: an array", () => new Promise(resolve => { process.nextTick(pushes10, ([5, 6])); process.nextTick(resolve); }));
  await observe("process.nextTick: an array-like", () => new Promise(resolve => { process.nextTick(pushes10, (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } }))); process.nextTick(resolve); }));
  await observe("process.nextTick: a subclass", () => new Promise(resolve => { process.nextTick(pushes10, (Odd.of(5, 6))); process.nextTick(resolve); }));
  await observe("process.nextTick: an array again", () => new Promise(resolve => { process.nextTick(pushes10, ([5, 6])); process.nextTick(resolve); }));

  pushes11([5, 6]);
  pushes11([5, 6]);
  await observe("queueMicrotask through bind: an array", () => new Promise(resolve => { queueMicrotask(pushes11.bind(undefined, ([5, 6]))); queueMicrotask(resolve); }));
  await observe("queueMicrotask through bind: an array-like", () => new Promise(resolve => { queueMicrotask(pushes11.bind(undefined, (({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })))); queueMicrotask(resolve); }));
  await observe("queueMicrotask through bind: a subclass", () => new Promise(resolve => { queueMicrotask(pushes11.bind(undefined, (Odd.of(5, 6)))); queueMicrotask(resolve); }));
  await observe("queueMicrotask through bind: an array again", () => new Promise(resolve => { queueMicrotask(pushes11.bind(undefined, ([5, 6]))); queueMicrotask(resolve); }));
}

main();

// GENERATED: attempt observe pushes1 Odd
// CHECK-LABEL: function {{*}}name="attempt"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasThis, HasExplicitName] length=2 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}, {type=anything}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything, v2: anything, v3: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = NewRuntimeError runtimeError=LeftOutOfExecutable name="attempt"
// CHECK-NEXT: Throw v4
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="observe"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsAsync, IsSloppy, HasThis, HasExplicitName] length=2 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=undefined|null|Promise flags=[IsExpected]}] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything, v2: anything, v3: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v4 = ToThis v1
// CHECK-NEXT: v5 = GetEnvironmentField v0 layout=[[L_1]] field=16
// CHECK-NEXT: v6 = CheckInitialized v5 name="results"
// CHECK-NEXT: v7 = Integer
// CHECK-NEXT: v8 = Convert v7 declared={type=number flags=[IsExpected]}
// CHECK-NEXT: PropSet v6, v8 key="length" mode=Sloppy
// CHECK-NEXT: v10 = GetEnvironmentField v0 layout=[[L_1]] field=1
// CHECK-NEXT: v11 = NewClosure v3 function=[[f_2]]
// CHECK-NEXT: v12 = Call v10, -, v11 calleeName="outcome"
// CHECK-NEXT: v13 = Convert v12 declared={type=undefined|null|Promise<undefined|null|string> flags=[IsExpected]}
// CHECK-NEXT: v14 = Await v13, v2, v3
// CHECK-NEXT: v15 = Convert v14 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v16 = Builtin builtin=GlobalThis
// CHECK-NEXT: v17 = PropGet v16 key="console" [isFreeName]
// CHECK-NEXT: v18 = Convert v17 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v19 = PropGet v18 key="log"
// CHECK-NEXT: v20 = Convert v19 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v21 = String string=" -> "
// CHECK-NEXT: v22 = Add v2, v21
// CHECK-NEXT: v23 = GetEnvironmentField v0 layout=[[L_1]]
// CHECK-NEXT: v24 = GetEnvironmentField v0 layout=[[L_1]] field=16
// CHECK-NEXT: v25 = CheckInitialized v24 name="results"
// CHECK-NEXT: v26 = Call v23, -, v25 calleeName="show"
// CHECK-NEXT: v27 = Convert v26 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: v28 = Add v22, v27
// CHECK-NEXT: v29 = String string=" "
// CHECK-NEXT: v30 = Add v28, v29
// CHECK-NEXT: v31 = Add v30, v15
// CHECK-NEXT: v32 = Call v20, v18, v31 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v33 = Undefined
// CHECK-NEXT: Return v33
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="pushes1"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=1 captures=[{type=env [[L_1]] flags=[IsFromCompiler]}] thisType={type=anything} parameters=[{type=anything}] results=[{type=anything}] functionTypes={{*}}[[f_3]]] {
// CHECK-NEXT: b0(v0: env [[L_1]], v1: anything):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = PropGet v1 key="push"
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|function flags=[IsExpected]}
// CHECK-NEXT: v4 = Integer integer=1
// CHECK-NEXT: v5 = Call v3, v1, v4 calleeKey="push" calleeName="a.push"
// CHECK-NEXT: v6 = PropGet v1 key="length"
// CHECK-NEXT: v7 = GetEnvironmentField v0 layout=[[L_1]] field=16
// CHECK-NEXT: v8 = CheckInitialized v7 name="results"
// CHECK-NEXT: v9 = PropGet v8 key="push"
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|[[f_4]] flags=[IsExpected]}
// CHECK-NEXT: v11 = Call v10, v8, v6 calleeKey="push" calleeName="results.push"
// CHECK-NEXT: Return v6
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="Odd"
// CHECK: module=[[m_0]] position={{*}} text={{*}} kind=DerivedConstructor flags=[HasRestParameter, HasNewTarget, TakesCallee, HasExplicitName] thisType={type=anything} parameters=[{type=Array flags=[IsFromCompiler]}] results=[{type=object flags=[IsFromCompiler]}] {
// CHECK-NEXT: b0(v0: function, v1: anything, v2: Array):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v3 = GetSuperBase v0
// CHECK-NEXT: v4 = SuperConstructList v3, v1, v2 layout=[[L_5]]
// CHECK-NEXT: v5 = Convert v4 declared={type=[[L_5]] flags=[IsFromCompiler]} illTypedCause=FromLooseType
// CHECK-NEXT: Return v5
// CHECK-NEXT: }
