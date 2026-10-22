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

function turns(lists, numbers, objects, order) {
  let total = 0;
  for (let i = 0; i < lists.length; i++) {
    const a = lists[i];
    const n = numbers[i];
    const o = objects[i];
    a.push(n);
    total = total + (n | 0);
    order.push(a.length, n + 1, o.x + o.y);
    o.x = total;
  }
  return total;
}
function carries(a, n, o, replacements, order) {
  for (let i = 0; i < 8; i++) {
    const next = replacements[i];
    if (next) {
      if ("a" in next) a = next.a;
      if ("n" in next) n = next.n;
      if ("o" in next) o = next.o;
    }
    a.push(i);
    order.push(a.length, n | 0, n + 1, o.x + o.y);
  }
  return "done";
}

const list = [() => [5, 6], () => Odd.of(5, 6), () => ({ length: 7, push(value) { log.push("own push " + show(value)); } }), () => logged([5])];
const number = [() => 7, () => "3", () => ({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; } }), () => 2147483647, () => -0];
const object = [() => ({ x: 1, y: 2 }), () => ({ get x() { log.push("get x"); return 10; }, set x(value) { log.push("set x " + value); }, y: 20 }), () => logged({ y: 2, x: 1 }), () => ({ y: "2", x: "1" })];

for (let i = 0; i < 1000; i++) {
  turns([[5, 6], [5, 6], [5, 6]], [7, 7, 7], [{ x: 1, y: 2 }, { x: 1, y: 2 }, { x: 1, y: 2 }], []);
  carries([5, 6], 7, { x: 1, y: 2 }, [], []);
}

const plans = ["000 000 000", "010 000 000", "000 010 000", "000 000 010", "010 010 010", "100 010 001", "001 010 100", "123 123 123", "0123 4321 3210", "00000100 00100000 00001000"];
for (const plan of plans) {
  const [lists, numbers, objects] = plan.split(" ");
  const order = [];
  const end = outcome(() => turns([...lists].map(d => list[d]()), [...numbers].map(d => number[d]()), [...objects].map(d => object[d]()), order));
  console.log("read from lists, " + plan + " -> " + show(order) + " " + end);
}
const replacementPlans = [
  ["nothing", {}],
  ["the array at 3", { 3: { a: 1 } }],
  ["the number at 3", { 3: { n: 1 } }],
  ["the object at 3", { 3: { o: 1 } }],
  ["all three at 3", { 3: { a: 1, n: 1, o: 1 } }],
  ["one after the other", { 2: { a: 2 }, 4: { n: 2 }, 6: { o: 2 } }],
  ["there and back", { 2: { a: 1, n: 3, o: 3 }, 4: { a: 0, n: 0, o: 0 }, 6: { a: 3, n: 4, o: 1 } }],
  ["at the first turn", { 0: { a: 2, n: 2, o: 2 } }],
  ["at the last turn", { 7: { a: 1, n: 1, o: 1 } }],
];
for (const [label, plan] of replacementPlans) {
  const replacements = [];
  for (const [turn, parts] of Object.entries(plan)) {
    replacements[turn] = {};
    if ("a" in parts) replacements[turn].a = list[parts.a]();
    if ("n" in parts) replacements[turn].n = number[parts.n]();
    if ("o" in parts) replacements[turn].o = object[parts.o]();
  }
  const order = [];
  const end = outcome(() => carries([5, 6], 7, { x: 1, y: 2 }, replacements, order));
  console.log("carried around the loop, " + label + " -> " + show(order) + " " + end);
}
