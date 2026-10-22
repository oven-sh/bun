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
