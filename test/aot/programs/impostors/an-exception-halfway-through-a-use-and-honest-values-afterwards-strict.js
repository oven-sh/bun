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

console.log("strict:", (function () { return this === undefined; })());

function pushesThree(a) {
  a.push(1, 2, 3);
  return a.length;
}
function iterates(a, seen) {
  for (const x of a) seen.push(x);
  return "done";
}
function iteratesAndFails(a, seen) {
  for (const x of a) {
    if (x === "fail") throw new RangeError("in the body");
    seen.push(x);
  }
  return "done";
}
function addsMembers(o) {
  return o.x + o.y;
}
function storesTwoMembers(o) {
  o.x = 1;
  o.y = 2;
  return o;
}
function addsOne(n) {
  return n + 1;
}
function truncates(n) {
  return n | 0;
}
function calls(f) {
  return f(1);
}

function failing(at, closes) {
  let count = 0;
  const iterator = {
    next() {
      log.push("next");
      if (++count === at) throw new EvalError("in next");
      return { done: count > 3, value: count };
    },
  };
  if (closes) iterator.return = () => (log.push("return"), {});
  return { [Symbol.iterator]: () => iterator };
}

function rounds(label, use, honest, impostor) {
  const lines = new Map();
  for (let i = 0; i < 1200; i++) {
    const isImpostor = i === 0 || i === 1000 || i === 1001 || i === 1199;
    const value = isImpostor ? impostor() : honest();
    const line = (isImpostor ? "impostor " : "honest ") + outcome(() => use(value)) + " leaves " + state(value);
    lines.set(line, (lines.get(line) ?? 0) + 1);
  }
  for (const [line, count] of lines) console.log(label + " -> " + line + " x" + count);
}
function state(value) {
  if (typeof value !== "object" || value === null) return show(value);
  if (Array.isArray(value) && value.length > 100) return "length " + value.length + ", own keys " + Object.keys(value).join();
  const parts = Reflect.ownKeys(value).map(key => {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return String(key) + ": " + ("value" in descriptor ? show(descriptor.value) : "accessor");
  });
  return "{" + parts.join(", ") + "}";
}

rounds("push onto an array that takes no more members", pushesThree, () => [5], () => Object.preventExtensions([5]));
rounds("push onto a sealed array", pushesThree, () => [5], () => Object.seal([5]));
rounds("push onto an array whose length is read-only", pushesThree, () => [5], () => Object.defineProperty([5], "length", { writable: false }));
rounds("push onto an array two short of the longest", pushesThree, () => [5], () => { const a = []; a.length = 2 ** 32 - 3; return a; });
rounds("push onto an array with a read-only member of the prototype in its way", pushesThree, () => [5], () => Object.setPrototypeOf([5], Object.create(Array.prototype, { 2: { value: "fixed", writable: false } })));
rounds("push onto an array with a setter of the prototype in its way", pushesThree, () => [5], () => Object.setPrototypeOf([5], Object.create(Array.prototype, { 2: { set(value) { log.push("set 2 " + value); throw new EvalError("in the setter"); } } })));

for (const closes of [false, true]) {
  const seen = [];
  const suffix = closes ? ", the iterator has return" : "";
  attempt("for-of, next throws at once" + suffix, () => iterates(failing(1, closes), seen));
  attempt("for-of, next throws the second time" + suffix, () => iterates(failing(2, closes), seen));
  attempt("for-of over an array afterwards" + suffix, () => iterates([5, 6], seen));
  attempt("for-of, nothing throws" + suffix, () => iterates(failing(9, closes), seen));
  console.log("seen " + show(seen));
}
rounds("for-of, the body throws at the second element", a => { const seen = []; try { return iteratesAndFails(a, seen); } finally { log.push("seen " + seen.join()); } }, () => [5, 6, 7], () => [5, "fail", 7]);
attempt("for-of, the body throws and the iterator is closed", () => iteratesAndFails({ [Symbol.iterator]: () => ({ next: () => (log.push("next"), { done: false, value: "fail" }), return: () => (log.push("return"), {}) }) }, []));
attempt("for-of, the body throws and closing throws too", () => iteratesAndFails({ [Symbol.iterator]: () => ({ next: () => ({ done: false, value: "fail" }), return() { log.push("return"); throw new EvalError("in return"); } }) }, []));

rounds("o.x + o.y, the getter of y throws", addsMembers, () => ({ x: 1, y: 2 }), () => ({ get x() { log.push("get x"); return 1; }, get y() { log.push("get y"); throw new EvalError("in y"); } }));
rounds("o.x + o.y, the getter of x throws", addsMembers, () => ({ x: 1, y: 2 }), () => ({ get x() { log.push("get x"); throw new EvalError("in x"); }, get y() { log.push("get y"); return 2; } }));
rounds("o.x + o.y, the valueOf of y throws", addsMembers, () => ({ x: 1, y: 2 }), () => ({ x: { valueOf() { log.push("valueOf x"); return 1; } }, y: { valueOf() { log.push("valueOf y"); throw new EvalError("in valueOf"); } } }));
rounds("o.x + o.y of null", addsMembers, () => ({ x: 1, y: 2 }), () => null);
rounds("two stores, the setter of y throws", storesTwoMembers, () => ({ x: 0, y: 0 }), () => ({ x: 0, set y(value) { log.push("set y " + value); throw new EvalError("in y"); } }));
rounds("two stores, y is read-only", storesTwoMembers, () => ({ x: 0, y: 0 }), () => Object.defineProperty({ x: 0 }, "y", { value: "fixed", enumerable: true }));
rounds("two stores, no more members are taken", storesTwoMembers, () => ({ x: 0, y: 0 }), () => Object.preventExtensions({ x: 0 }));
rounds("n + 1, valueOf throws", addsOne, () => 7, () => ({ valueOf() { log.push("valueOf"); throw new EvalError("in valueOf"); }, toString() { log.push("toString"); return "text"; } }));
rounds("n + 1, valueOf returns an object", addsOne, () => 7, () => ({ valueOf() { log.push("valueOf"); return {}; }, toString() { log.push("toString"); return "text"; } }));
rounds("n + 1, both return objects", addsOne, () => 7, () => ({ valueOf() { log.push("valueOf"); return {}; }, toString() { log.push("toString"); return {}; } }));
rounds("n | 0, a symbol", truncates, () => 7, () => Symbol("s"));
rounds("n | 0, Symbol.toPrimitive returns an object", truncates, () => 7, () => ({ [Symbol.toPrimitive](hint) { log.push("hint " + hint); return {}; } }));
rounds("f(1), the callee throws after an effect", calls, () => x => x + 1, () => x => { log.push("effect " + x); throw new EvalError("in the callee"); });
rounds("f(1), a generator function", calls, () => x => x + 1, () => function* (x) { log.push("never runs"); yield x; });
