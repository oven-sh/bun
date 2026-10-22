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

console.log("strict:", (function () { return this === undefined; })());

const honest = value => ({ done: false, value });
const results = [
  ["plain objects", honest],
  ["value before done", value => ({ value, done: false })],
  ["getters", value => ({ get done() { log.push("get done"); return false; }, get value() { log.push("get value"); return value; } })],
  ["a proxy", value => logged({ done: false, value })],
  ["inherited members", value => Object.create({ done: false, value })],
  ["no done at all", value => ({ value })],
  ["done is zero", value => ({ done: 0, value })],
  ["done is an empty text", value => ({ done: "", value })],
  ["done is a text", value => ({ done: "no", value })],
  ["done is an object", value => ({ done: {}, value })],
  ["no value at all", () => ({ done: false })],
  ["an array", value => Object.assign([], { done: false, value })],
  ["a function", value => Object.assign(() => {}, { done: false, value })],
  ["a number", () => 5],
  ["undefined", () => undefined],
  ["null", () => null],
  ["a frozen object with more members", value => Object.freeze({ extra: 1, done: false, more: 2, value })],
];

function iterating(wrap) {
  return {
    [Symbol.iterator]() {
      let count = 0;
      return {
        next() {
          return ++count > 2 ? { done: true, value: "ignored" } : wrap(count);
        },
        return() {
          log.push("return");
          return {};
        },
      };
    },
  };
}

function loops(iterable) {
  const seen = [];
  for (const x of iterable) seen.push(x);
  return seen;
}
function spreads(iterable) {
  return [...iterable];
}
function destructures(iterable) {
  const [first, second] = iterable;
  return [first, second];
}
function destructuresTheRest(iterable) {
  const [first, ...rest] = iterable;
  return [first, rest];
}
function passesAsArguments(iterable) {
  return Math.max(...iterable);
}
function* delegates(iterable) {
  yield* iterable;
}
function collects(iterable) {
  return [Array.from(iterable), new Set(iterable).size];
}
function stepsByHand(iterable) {
  const iterator = iterable[Symbol.iterator]();
  const seen = [];
  for (let step = iterator.next(); !step.done; step = iterator.next()) seen.push(step.value);
  return seen;
}

const table = [
  ["for-of", loops],
  ["spread", spreads],
  ["destructuring", destructures],
  ["destructuring with a rest", destructuresTheRest],
  ["spread arguments", passesAsArguments],
  ["yield*", iterable => { const seen = []; for (const x of delegates(iterable)) seen.push(x); return seen; }],
  ["Array.from and Set", collects],
  ["by hand", stepsByHand],
];
for (let i = 0; i < 2000; i++) {
  loops(iterating(honest));
  spreads(iterating(honest));
  destructures(iterating(honest));
  destructuresTheRest(iterating(honest));
  passesAsArguments(iterating(honest));
  stepsByHand(iterating(honest));
}
for (const [name, use] of table) {
  for (const [label, wrap] of [...results, results[0]]) attempt(name + ": " + label, () => use(iterating(wrap)));
}
