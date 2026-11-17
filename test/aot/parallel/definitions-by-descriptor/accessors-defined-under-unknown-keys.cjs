// Object.defineProperty with a descriptor whose attributes are known at run time alone, as another object of the same kind got it.
// COUNTER: AccessorsShared >= 500
"use strict";
const define = Object.defineProperty, pairs = {}, log = [];
let calls = 0;
function pairOf(key) {
  return pairs[key] || (pairs[key] = { get: function () { calls++; return this.store.get(key); }, set: function (value) { calls++; this.store.set(key, value); } });
}
const show = (value) => value === null || typeof value !== "object" ? Object.is(value, -0) ? "-0" : typeof value === "function" ? "function " + value.name : String(value) : JSON.stringify(value);
const describe = (object, key) => {
  const found = Object.getOwnPropertyDescriptor(object, key);
  return found ? Object.keys(found).map((name) => name + "=" + (typeof found[name] === "function" ? "function" : show(found[name]))).join() : "none";
};
const attempt = (action) => { try { return show(action()); } catch (error) { return error.name + ": " + error.message; } };
class Item {
  title; done = false; tags = [];
  constructor(title) { this.title = title; this.store = new Map(); }
  get label() { return "label " + this.title; }
}
class Late extends Item { constructor(title, key, options) { super(title); observe(this, key, options); } }
function observe(object, key, options) {
  const pair = pairOf(key), descriptor = { configurable: !options.fixed, enumerable: options.listed, get: pair.get, set: options.readOnly ? undefined : pair.set };
  object.store.set(key, object[key]);
  if (options.reflect) return Reflect.defineProperty(object, key, descriptor);
  return define(object, key, descriptor);
}
const choices = [];
for (const fixed of [false, true]) for (const listed of [false, true]) for (const readOnly of [false, true]) for (const reflect of [false, true]) choices.push({ fixed, listed, readOnly, reflect });
for (let turn = 0; turn < 200; turn++) {
  const choice = choices[turn % choices.length];
  for (const key of ["title", "done", "tags", "extra", "label"]) {
    const item = new Item("t" + turn), result = observe(item, key, choice);
    const late = new Late("l" + turn, key, choice);
    if (turn < 40 || turn % 50 === 0) {
      log.push(key + " " + (result === item ? "item" : show(result)) + " " + show(item[key]) + " " + describe(item, key) + " " + Object.keys(item).join());
      log.push(attempt(() => { late[key] = "new"; return late[key]; }) + " " + attempt(() => delete late[key]) + " " + show(late[key]));
      const a = Object.getOwnPropertyDescriptor(item, key), b = Object.getOwnPropertyDescriptor(new Late("m", key, choice), key);
      log.push(String(a.get === b.get) + String(a.set === b.set) + attempt(() => observe(item, key, choices[(turn + 5) % choices.length]) === item) + " " + describe(item, key));
    }
  }
  if (turn % 60 === 0 && typeof gc === "function") gc();
  if (turn % 60 === 0 && typeof Bun !== "undefined") Bun.gc(true);
}
// Every object has the functions it was given, whatever the object before it was given.
for (let turn = 0; turn < 60; turn++) {
  const item = new Item("own"), other = new Item("other"), key = turn % 2 ? "title" : "added";
  const flags = { listed: turn % 3 !== 0, kept: turn % 5 === 0 };
  const first = { configurable: !flags.kept, enumerable: flags.listed, get: () => "first " + turn, set: undefined };
  const second = { configurable: !flags.kept, enumerable: flags.listed, get: turn % 4 ? () => "second " + turn : undefined, set: (value) => { log.push("set " + value); } };
  define(item, key, first); define(other, key, second);
  other[key] = turn;
  log.push(show(item[key]) + " " + show(other[key]) + " " + describe(item, key) + " " + describe(other, key));
}
// Descriptors that run code, inherit, or are no descriptors.
const order = [];
const strange = [
  { get enumerable() { order.push("enumerable"); return true; }, get configurable() { order.push("configurable"); return true; }, get get() { order.push("get"); return () => 1; }, set: undefined },
  Object.create({ get: () => "inherited", enumerable: true, configurable: true }),
  new Proxy({ get: () => "proxy", enumerable: 1, configurable: 0 }, { get(target, key) { order.push("trap " + String(key)); return target[key]; }, has(target, key) { order.push("has " + String(key)); return key in target; } }),
  { enumerable: 1, configurable: "", get: () => "truthy", set: undefined },
  { enumerable: true, configurable: true, get: 1, set: undefined }, { enumerable: true, configurable: true, get: undefined, set: {} }, { enumerable: true, configurable: true, get: undefined, set: undefined },
  { enumerable: true, configurable: true, get: () => 1, value: 2 }, { enumerable: true, configurable: true, set: () => 1, writable: false }, { enumerable: true, configurable: true, value: 1, writable: true },
  { enumerable: true, get: () => "half" }, { get: () => "alone" }, { set: undefined }, {}, [], () => 1, null, undefined, 1, "text",
  Object.assign(Object.create(null), { get: () => "null", enumerable: true, configurable: true }),
];
const targets = [() => new Item("s"), () => ({ title: 1, store: new Map() }), () => [1, 2], () => function named() {}, () => Object.freeze(new Item("f")), () => Object.preventExtensions(new Item("p")), () => new Proxy(new Item("x"), {}), () => null, () => 1, () => "text", () => class { static title = 1; }];
const keys = ["title", "added", "length", "name", 0, 1.5, Symbol.iterator, Symbol("own"), { toString() { order.push("key"); return "keyed"; } }, { toString() { throw new Error("no key"); } }];
for (const description of strange) for (const target of targets) for (const key of keys) {
  order.length = 0;
  const object = target();
  log.push(attempt(() => define(object, key, description) === object) + " " + order.join("|") + " " + (object !== null && typeof object === "object" && typeof key !== "object" ? describe(object, key) : ""));
}
console.log(log.length, calls, attempt(() => define()), attempt(() => define({})), attempt(() => define({}, "a")), attempt(() => Object.defineProperty.call(undefined, { a: 1 }, "a", { value: 2 })));
console.log(log.join("\n"));
