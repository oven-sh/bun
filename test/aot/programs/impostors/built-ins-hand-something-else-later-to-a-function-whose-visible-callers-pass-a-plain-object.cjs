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

function addsMembers1(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers2(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers3(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers4(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers5(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers6(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers7(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers8(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers9(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers10(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

function addsMembers11(o) {
  const result = o.x + o.y;
  results.push(result);
  return result;
}

async function main() {
  console.log("strict:", (function () { return this === undefined; })());

  addsMembers1(({ x: 1, y: 2 }));
  addsMembers1(({ x: 1, y: 2 }));
  await observe("then: an object", () => Promise.resolve((({ x: 1, y: 2 }))).then(addsMembers1));
  await observe("then: accessors", () => Promise.resolve((({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))).then(addsMembers1));
  await observe("then: a proxy", () => Promise.resolve((logged({ y: 2, x: 1 }))).then(addsMembers1));
  await observe("then: an object again", () => Promise.resolve((({ x: 1, y: 2 }))).then(addsMembers1));

  addsMembers2(({ x: 1, y: 2 }));
  addsMembers2(({ x: 1, y: 2 }));
  await observe("catch: an object", () => Promise.reject((({ x: 1, y: 2 }))).catch(addsMembers2));
  await observe("catch: accessors", () => Promise.reject((({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))).catch(addsMembers2));
  await observe("catch: a proxy", () => Promise.reject((logged({ y: 2, x: 1 }))).catch(addsMembers2));
  await observe("catch: an object again", () => Promise.reject((({ x: 1, y: 2 }))).catch(addsMembers2));

  addsMembers3(({ x: 1, y: 2 }));
  addsMembers3(({ x: 1, y: 2 }));
  await observe("the second function of then: an object", () => Promise.reject((({ x: 1, y: 2 }))).then(undefined, addsMembers3));
  await observe("the second function of then: accessors", () => Promise.reject((({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))).then(undefined, addsMembers3));
  await observe("the second function of then: a proxy", () => Promise.reject((logged({ y: 2, x: 1 }))).then(undefined, addsMembers3));
  await observe("the second function of then: an object again", () => Promise.reject((({ x: 1, y: 2 }))).then(undefined, addsMembers3));

  addsMembers4(({ x: 1, y: 2 }));
  addsMembers4(({ x: 1, y: 2 }));
  await observe("then of a promise resolved later: an object", () => new Promise(resolve => setTimeout(resolve, 0, (({ x: 1, y: 2 })))).then(addsMembers4));
  await observe("then of a promise resolved later: accessors", () => new Promise(resolve => setTimeout(resolve, 0, (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })))).then(addsMembers4));
  await observe("then of a promise resolved later: a proxy", () => new Promise(resolve => setTimeout(resolve, 0, (logged({ y: 2, x: 1 })))).then(addsMembers4));
  await observe("then of a promise resolved later: an object again", () => new Promise(resolve => setTimeout(resolve, 0, (({ x: 1, y: 2 })))).then(addsMembers4));

  addsMembers5(({ x: 1, y: 2 }));
  addsMembers5(({ x: 1, y: 2 }));
  await observe("then of a thenable's value: an object", () => Promise.resolve({ then(resolve) { resolve((({ x: 1, y: 2 }))); } }).then(addsMembers5));
  await observe("then of a thenable's value: accessors", () => Promise.resolve({ then(resolve) { resolve((({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))); } }).then(addsMembers5));
  await observe("then of a thenable's value: a proxy", () => Promise.resolve({ then(resolve) { resolve((logged({ y: 2, x: 1 }))); } }).then(addsMembers5));
  await observe("then of a thenable's value: an object again", () => Promise.resolve({ then(resolve) { resolve((({ x: 1, y: 2 }))); } }).then(addsMembers5));

  addsMembers6(({ x: 1, y: 2 }));
  addsMembers6(({ x: 1, y: 2 }));
  await observe("Promise.try: an object", () => Promise.try(addsMembers6, (({ x: 1, y: 2 }))));
  await observe("Promise.try: accessors", () => Promise.try(addsMembers6, (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))));
  await observe("Promise.try: a proxy", () => Promise.try(addsMembers6, (logged({ y: 2, x: 1 }))));
  await observe("Promise.try: an object again", () => Promise.try(addsMembers6, (({ x: 1, y: 2 }))));

  addsMembers7(({ x: 1, y: 2 }));
  addsMembers7(({ x: 1, y: 2 }));
  await observe("Array.fromAsync: an object", () => Array.fromAsync([(({ x: 1, y: 2 }))], addsMembers7));
  await observe("Array.fromAsync: accessors", () => Array.fromAsync([(({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))], addsMembers7));
  await observe("Array.fromAsync: a proxy", () => Array.fromAsync([(logged({ y: 2, x: 1 }))], addsMembers7));
  await observe("Array.fromAsync: an object again", () => Array.fromAsync([(({ x: 1, y: 2 }))], addsMembers7));

  addsMembers8(({ x: 1, y: 2 }));
  addsMembers8(({ x: 1, y: 2 }));
  await observe("setTimeout: an object", () => new Promise(resolve => { setTimeout(addsMembers8, 0, (({ x: 1, y: 2 }))); setTimeout(resolve, 1); }));
  await observe("setTimeout: accessors", () => new Promise(resolve => { setTimeout(addsMembers8, 0, (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))); setTimeout(resolve, 1); }));
  await observe("setTimeout: a proxy", () => new Promise(resolve => { setTimeout(addsMembers8, 0, (logged({ y: 2, x: 1 }))); setTimeout(resolve, 1); }));
  await observe("setTimeout: an object again", () => new Promise(resolve => { setTimeout(addsMembers8, 0, (({ x: 1, y: 2 }))); setTimeout(resolve, 1); }));

  addsMembers9(({ x: 1, y: 2 }));
  addsMembers9(({ x: 1, y: 2 }));
  await observe("setImmediate: an object", () => new Promise(resolve => { setImmediate(addsMembers9, (({ x: 1, y: 2 }))); setImmediate(resolve); }));
  await observe("setImmediate: accessors", () => new Promise(resolve => { setImmediate(addsMembers9, (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))); setImmediate(resolve); }));
  await observe("setImmediate: a proxy", () => new Promise(resolve => { setImmediate(addsMembers9, (logged({ y: 2, x: 1 }))); setImmediate(resolve); }));
  await observe("setImmediate: an object again", () => new Promise(resolve => { setImmediate(addsMembers9, (({ x: 1, y: 2 }))); setImmediate(resolve); }));

  addsMembers10(({ x: 1, y: 2 }));
  addsMembers10(({ x: 1, y: 2 }));
  await observe("process.nextTick: an object", () => new Promise(resolve => { process.nextTick(addsMembers10, (({ x: 1, y: 2 }))); process.nextTick(resolve); }));
  await observe("process.nextTick: accessors", () => new Promise(resolve => { process.nextTick(addsMembers10, (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } }))); process.nextTick(resolve); }));
  await observe("process.nextTick: a proxy", () => new Promise(resolve => { process.nextTick(addsMembers10, (logged({ y: 2, x: 1 }))); process.nextTick(resolve); }));
  await observe("process.nextTick: an object again", () => new Promise(resolve => { process.nextTick(addsMembers10, (({ x: 1, y: 2 }))); process.nextTick(resolve); }));

  addsMembers11(({ x: 1, y: 2 }));
  addsMembers11(({ x: 1, y: 2 }));
  await observe("queueMicrotask through bind: an object", () => new Promise(resolve => { queueMicrotask(addsMembers11.bind(undefined, (({ x: 1, y: 2 })))); queueMicrotask(resolve); }));
  await observe("queueMicrotask through bind: accessors", () => new Promise(resolve => { queueMicrotask(addsMembers11.bind(undefined, (({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, get y() { log.push("get y"); return 20; } })))); queueMicrotask(resolve); }));
  await observe("queueMicrotask through bind: a proxy", () => new Promise(resolve => { queueMicrotask(addsMembers11.bind(undefined, (logged({ y: 2, x: 1 })))); queueMicrotask(resolve); }));
  await observe("queueMicrotask through bind: an object again", () => new Promise(resolve => { queueMicrotask(addsMembers11.bind(undefined, (({ x: 1, y: 2 })))); queueMicrotask(resolve); }));
}

main();
