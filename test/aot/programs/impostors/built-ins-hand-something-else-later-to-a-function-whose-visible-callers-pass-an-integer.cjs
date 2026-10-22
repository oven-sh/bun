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

function addsOne1(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne2(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne3(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne4(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne5(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne6(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne7(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne8(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne9(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne10(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

function addsOne11(n) {
  const result = n + 1;
  results.push(result);
  return result;
}

async function main() {
  console.log("strict:", (function () { return this === undefined; })());

  addsOne1(7);
  addsOne1(7);
  await observe("then: an integer", () => Promise.resolve((7)).then(addsOne1));
  await observe("then: an object with valueOf", () => Promise.resolve((({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))).then(addsOne1));
  await observe("then: a string", () => Promise.resolve(("3")).then(addsOne1));
  await observe("then: an integer again", () => Promise.resolve((7)).then(addsOne1));

  addsOne2(7);
  addsOne2(7);
  await observe("catch: an integer", () => Promise.reject((7)).catch(addsOne2));
  await observe("catch: an object with valueOf", () => Promise.reject((({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))).catch(addsOne2));
  await observe("catch: a string", () => Promise.reject(("3")).catch(addsOne2));
  await observe("catch: an integer again", () => Promise.reject((7)).catch(addsOne2));

  addsOne3(7);
  addsOne3(7);
  await observe("the second function of then: an integer", () => Promise.reject((7)).then(undefined, addsOne3));
  await observe("the second function of then: an object with valueOf", () => Promise.reject((({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))).then(undefined, addsOne3));
  await observe("the second function of then: a string", () => Promise.reject(("3")).then(undefined, addsOne3));
  await observe("the second function of then: an integer again", () => Promise.reject((7)).then(undefined, addsOne3));

  addsOne4(7);
  addsOne4(7);
  await observe("then of a promise resolved later: an integer", () => new Promise(resolve => setTimeout(resolve, 0, (7))).then(addsOne4));
  await observe("then of a promise resolved later: an object with valueOf", () => new Promise(resolve => setTimeout(resolve, 0, (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })))).then(addsOne4));
  await observe("then of a promise resolved later: a string", () => new Promise(resolve => setTimeout(resolve, 0, ("3"))).then(addsOne4));
  await observe("then of a promise resolved later: an integer again", () => new Promise(resolve => setTimeout(resolve, 0, (7))).then(addsOne4));

  addsOne5(7);
  addsOne5(7);
  await observe("then of a thenable's value: an integer", () => Promise.resolve({ then(resolve) { resolve((7)); } }).then(addsOne5));
  await observe("then of a thenable's value: an object with valueOf", () => Promise.resolve({ then(resolve) { resolve((({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))); } }).then(addsOne5));
  await observe("then of a thenable's value: a string", () => Promise.resolve({ then(resolve) { resolve(("3")); } }).then(addsOne5));
  await observe("then of a thenable's value: an integer again", () => Promise.resolve({ then(resolve) { resolve((7)); } }).then(addsOne5));

  addsOne6(7);
  addsOne6(7);
  await observe("Promise.try: an integer", () => Promise.try(addsOne6, (7)));
  await observe("Promise.try: an object with valueOf", () => Promise.try(addsOne6, (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))));
  await observe("Promise.try: a string", () => Promise.try(addsOne6, ("3")));
  await observe("Promise.try: an integer again", () => Promise.try(addsOne6, (7)));

  addsOne7(7);
  addsOne7(7);
  await observe("Array.fromAsync: an integer", () => Array.fromAsync([(7)], addsOne7));
  await observe("Array.fromAsync: an object with valueOf", () => Array.fromAsync([(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))], addsOne7));
  await observe("Array.fromAsync: a string", () => Array.fromAsync([("3")], addsOne7));
  await observe("Array.fromAsync: an integer again", () => Array.fromAsync([(7)], addsOne7));

  addsOne8(7);
  addsOne8(7);
  await observe("setTimeout: an integer", () => new Promise(resolve => { setTimeout(addsOne8, 0, (7)); setTimeout(resolve, 1); }));
  await observe("setTimeout: an object with valueOf", () => new Promise(resolve => { setTimeout(addsOne8, 0, (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))); setTimeout(resolve, 1); }));
  await observe("setTimeout: a string", () => new Promise(resolve => { setTimeout(addsOne8, 0, ("3")); setTimeout(resolve, 1); }));
  await observe("setTimeout: an integer again", () => new Promise(resolve => { setTimeout(addsOne8, 0, (7)); setTimeout(resolve, 1); }));

  addsOne9(7);
  addsOne9(7);
  await observe("setImmediate: an integer", () => new Promise(resolve => { setImmediate(addsOne9, (7)); setImmediate(resolve); }));
  await observe("setImmediate: an object with valueOf", () => new Promise(resolve => { setImmediate(addsOne9, (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))); setImmediate(resolve); }));
  await observe("setImmediate: a string", () => new Promise(resolve => { setImmediate(addsOne9, ("3")); setImmediate(resolve); }));
  await observe("setImmediate: an integer again", () => new Promise(resolve => { setImmediate(addsOne9, (7)); setImmediate(resolve); }));

  addsOne10(7);
  addsOne10(7);
  await observe("process.nextTick: an integer", () => new Promise(resolve => { process.nextTick(addsOne10, (7)); process.nextTick(resolve); }));
  await observe("process.nextTick: an object with valueOf", () => new Promise(resolve => { process.nextTick(addsOne10, (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } }))); process.nextTick(resolve); }));
  await observe("process.nextTick: a string", () => new Promise(resolve => { process.nextTick(addsOne10, ("3")); process.nextTick(resolve); }));
  await observe("process.nextTick: an integer again", () => new Promise(resolve => { process.nextTick(addsOne10, (7)); process.nextTick(resolve); }));

  addsOne11(7);
  addsOne11(7);
  await observe("queueMicrotask through bind: an integer", () => new Promise(resolve => { queueMicrotask(addsOne11.bind(undefined, (7))); queueMicrotask(resolve); }));
  await observe("queueMicrotask through bind: an object with valueOf", () => new Promise(resolve => { queueMicrotask(addsOne11.bind(undefined, (({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })))); queueMicrotask(resolve); }));
  await observe("queueMicrotask through bind: a string", () => new Promise(resolve => { queueMicrotask(addsOne11.bind(undefined, ("3"))); queueMicrotask(resolve); }));
  await observe("queueMicrotask through bind: an integer again", () => new Promise(resolve => { queueMicrotask(addsOne11.bind(undefined, (7))); queueMicrotask(resolve); }));
}

main();
