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

const arrays = [
  ["its prototype becomes that of a subclass", () => [5, 6], a => Object.setPrototypeOf(a, Odd.prototype)],
  ["its prototype becomes null", () => [5, 6], a => Object.setPrototypeOf(a, null)],
  ["it gets its own push and iterator", () => [5, 6], a => { a.push = value => { log.push("own push " + value); return -1; }; a[Symbol.iterator] = function* () { log.push("own iterator"); yield "own"; }; }],
  ["an element is deleted", () => [5, 6], a => delete a[0]],
  ["an element becomes an accessor", () => [5, 6], a => Object.defineProperty(a, 0, { get() { log.push("get 0"); return "got"; }, configurable: true })],
  ["its length stops being writable", () => [5, 6], a => Object.defineProperty(a, "length", { writable: false })],
  ["it is frozen", () => [5, 6], a => Object.freeze(a)],
  ["it is emptied", () => [5, 6], a => { a.length = 0; }],
  ["it is made longer", () => [5, 6], a => { a.length += 2; }],
  ["an element becomes a fraction and another a text", () => [5, 6], a => { a[0] = 0.5; a[1] = "text"; }],
  ["the class between it and Array gets a push and an iterator", () => new (class extends Array {})(5, 6), a => { const middle = Object.getPrototypeOf(a); middle.push = value => { log.push("late push " + value); return -2; }; middle[Symbol.iterator] = function* () { log.push("late iterator"); yield "late"; }; }],
];

const strings = [
  ["it gets its own charCodeAt", () => new String("abc"), s => { s.charCodeAt = index => { log.push("own charCodeAt " + index); return -1; }; }],
  ["its prototype becomes an object with charCodeAt", () => new String("abc"), s => Object.setPrototypeOf(s, { charCodeAt: () => "inherited" })],
  ["its prototype becomes null", () => new String("abc"), s => Object.setPrototypeOf(s, null)],
  ["the class between it and String gets a charCodeAt", () => new (class extends String {})("abc"), s => { Object.getPrototypeOf(s).charCodeAt = () => "late"; }],
];

const numbers = [
  ["it gets its own valueOf", () => new Number(7), n => { n.valueOf = () => { log.push("own valueOf"); return "3"; }; }],
  ["it gets its own Symbol.toPrimitive", () => new Number(7), n => { n[Symbol.toPrimitive] = hint => { log.push("hint " + hint); return 2 ** 31; }; }],
  ["its prototype becomes null", () => new Number(7), n => Object.setPrototypeOf(n, null)],
  ["its prototype becomes an object with valueOf", () => new Number(7), n => Object.setPrototypeOf(n, { valueOf: () => 0.5 })],
  ["its valueOf is deleted", () => ({ valueOf: () => 7 }), n => delete n.valueOf],
  ["the class between it and Number gets a valueOf", () => new (class extends Number {})(7), n => { Object.getPrototypeOf(n).valueOf = () => { log.push("late valueOf"); return "3"; }; }],
];

const functions = [
  ["it gets its own call", () => function (x) { return x + 1; }, f => { f.call = (self, x) => { log.push("own call"); return "mine " + x; }; }],
  ["its prototype becomes null", () => function (x) { return x + 1; }, f => Object.setPrototypeOf(f, null)],
  ["its prototype becomes an object with call", () => function (x) { return x + 1; }, f => Object.setPrototypeOf(f, { call: () => "inherited call" })],
];

const objects = [
  ["x becomes an accessor", () => ({ x: 1, y: 2 }), o => Object.defineProperty(o, "x", { get() { log.push("get x"); return 10; }, set(value) { log.push("set x " + value); }, enumerable: true, configurable: true })],
  ["x is deleted", () => ({ x: 1, y: 2 }), o => delete o.x],
  ["x is deleted and the prototype gets accessors", () => ({ x: 1, y: 2 }), o => { delete o.x; Object.setPrototypeOf(o, Object.defineProperty({}, "x", { get() { log.push("get x"); return 10; }, set(value) { log.push("set x " + value); }, enumerable: true, configurable: true })); }],
  ["a member is added", () => ({ x: 1, y: 2 }), o => { o.z = 3; }],
  ["x stops being writable", () => ({ x: 1, y: 2 }), o => Object.defineProperty(o, "x", { writable: false })],
  ["it is frozen", () => ({ x: 1, y: 2 }), o => Object.freeze(o)],
  ["a hundred members are added and removed", () => ({ x: 1, y: 2 }), o => { for (let k = 0; k < 100; k++) o["k" + k] = k; for (let k = 0; k < 100; k++) delete o["k" + k]; }],
  ["y becomes a text", () => ({ x: 1, y: 2 }), o => { o.y = "2"; }],
  ["its prototype becomes null", () => ({ x: 1, y: 2 }), o => Object.setPrototypeOf(o, null)],
  ["an own x hides the inherited one", () => Object.create({ x: 1, y: 2 }), o => Object.defineProperty(o, "x", { value: 100, writable: true, enumerable: true, configurable: true })],
  ["the x of the prototype changes", () => Object.create({ x: 1, y: 2 }), o => { Object.getPrototypeOf(o).x = 50; }],
  ["the y of the prototype becomes an accessor", () => Object.create({ x: 1, y: 2 }), o => Object.defineProperty(Object.getPrototypeOf(o), "y", { get() { log.push("get y"); return 20; } })],
  ["the own x is deleted and that of the prototype stops being writable", () => Object.create({ x: 1, y: 2 }), o => { delete o.x; Object.defineProperty(Object.getPrototypeOf(o), "x", { writable: false }); }],
  ["the prototype is replaced", () => Object.create({ x: 1, y: 2 }), o => Object.setPrototypeOf(o, { x: "other", y: "prototype" })],
  ["a prototype in the middle gets its own x and y", () => Object.create(Object.create({ x: 1, y: 2 })), o => Object.assign(Object.getPrototypeOf(o), { x: 100, y: 200 })],
  ["the own x is deleted and a prototype in the middle gets accessors", () => Object.create(Object.create({ x: 1, y: 2 })), o => { delete o.x; Object.defineProperty(Object.getPrototypeOf(o), "x", { get() { log.push("get x"); return 10; }, set(value) { log.push("set x " + value); }, enumerable: true, configurable: true }); }],
  ["a prototype is put in the middle", () => Object.create({ x: 1, y: 2 }), o => Object.setPrototypeOf(o, Object.create(Object.getPrototypeOf(o), { y: { value: "from the middle" } }))],
];

async function pushes(a, results) {
  for (let i = 0; i < 6; i++) {
    await undefined;
    results.push(a.push(i), a.length);
  }
  return "done";
}

async function iterates(a, results) {
  for (let i = 0; i < 6; i++) {
    await undefined;
    for (const x of a) results.push(x);
  }
  return "done";
}

async function readsCharCode(s, results) {
  for (let i = 0; i < 6; i++) {
    await undefined;
    results.push(s.charCodeAt(0));
  }
  return "done";
}

async function truncates(n, results) {
  for (let i = 0; i < 6; i++) {
    await undefined;
    results.push(n | 0);
  }
  return "done";
}

async function addsOne(n, results) {
  for (let i = 0; i < 6; i++) {
    await undefined;
    results.push(n + 1);
  }
  return "done";
}

async function callsThroughCall(f, results) {
  for (let i = 0; i < 6; i++) {
    await undefined;
    results.push(f.call(undefined, i));
  }
  return "done";
}

async function addsMembers(o, results) {
  for (let i = 0; i < 6; i++) {
    await undefined;
    results.push(o.x + o.y);
  }
  return "done";
}

async function storesMember(o, results) {
  for (let i = 0; i < 6; i++) {
    await undefined;
    o.x = i;
    results.push(o.x);
  }
  return "done";
}

const table = [
  ["pushes", pushes, arrays],
  ["iterates", iterates, arrays],
  ["readsCharCode", readsCharCode, strings],
  ["truncates", truncates, numbers],
  ["addsOne", addsOne, numbers],
  ["callsThroughCall", callsThroughCall, functions],
  ["addsMembers", addsMembers, objects],
  ["storesMember", storesMember, objects],
];

async function run(use, value, results, change) {
  const running = use(value, results);
  if (change) Promise.resolve().then(() => {}).then(() => {}).then(change);
  return running;
}

async function main() {
  console.log("strict:", (function () { return this === undefined; })());
  for (const [name, use, rows] of table) {
    for (let i = 0; i < 300; i++) await run(use, rows[0][1](), [], null);
    for (const [label, make, change] of rows) {
      const value = make();
      const results = [];
      const end = await outcome(() => run(use, value, results, () => change(value)));
      const again = [];
      const endAgain = await outcome(() => run(use, make(), again, null));
      console.log(name + ": " + label + " -> " + show(results) + " " + end + " ; now " + show(value) + " ; a fresh one " + show(again) + " " + endAgain);
    }
  }
}

main();
