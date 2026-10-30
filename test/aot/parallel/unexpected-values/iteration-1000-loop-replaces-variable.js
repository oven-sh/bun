// Iteration 1000 of a loop replaces the variable by the lookalikes.
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

function pushes(a, other) {
  const results = [];
  for (let i = 0; i < 1003; i++) {
    if (i === 1000) a = other;
    a.push(1);
    if (i > 997) results.push(a.length);
  }
  return results;
}

function iterates(a, other) {
  const results = [];
  for (let i = 0; i < 1003; i++) {
    if (i === 1000) a = other;
    const seen = [];
    for (const x of a) seen.push(x);
    if (i > 997) results.push(seen);
  }
  return results;
}

function readsCharCode(s, other) {
  const results = [];
  for (let i = 0; i < 1003; i++) {
    if (i === 1000) s = other;
    if (i > 997) results.push(s.charCodeAt(0));
  }
  return results;
}

function truncates(n, other) {
  const results = [];
  for (let i = 0; i < 1003; i++) {
    if (i === 1000) n = other;
    if (i > 997) results.push(n | 0);
  }
  return results;
}

function addsOne(n, other) {
  const results = [];
  for (let i = 0; i < 1003; i++) {
    if (i === 1000) n = other;
    if (i > 997) results.push(n + 1);
  }
  return results;
}

function calls(f, other) {
  const results = [];
  for (let i = 0; i < 1003; i++) {
    if (i === 1000) f = other;
    if (i > 997) results.push(f(1));
  }
  return results;
}

function addsMembers(o, other) {
  const results = [];
  for (let i = 0; i < 1003; i++) {
    if (i === 1000) o = other;
    if (i > 997) results.push(o.x + o.y);
  }
  return results;
}

function storesMember(o, other) {
  const results = [];
  for (let i = 0; i < 1003; i++) {
    if (i === 1000) o = other;
    o.x = 1;
    if (i > 997) results.push(o);
  }
  return results;
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
    for (const [label, make] of [...values, values[0]]) attempt(round + " " + name + " " + label, () => use(values[0][1](), make()));
  }
}

console.log("strict:", (function () { return this === undefined; })());
everyCase("at first");
for (let i = 0; i < 3; i++) {
  pushes([5, 6], [5, 6]);
  iterates([5, 6], [5, 6]);
  readsCharCode("abc", "abc");
  truncates(7, 7);
  addsOne(7, 7);
  calls(x => x + 1, x => x + 1);
  addsMembers(({ x: 1, y: 2 }), ({ x: 1, y: 2 }));
  storesMember(({ x: 1, y: 2 }), ({ x: 1, y: 2 }));
}
everyCase("after 3");
