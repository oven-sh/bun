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
