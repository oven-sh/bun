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

let shared = "same";
let fire = () => {};

const withMethods = () => ({
  valueOf() {
    fire();
    return 1;
  },
  toString() {
    fire();
    return "1";
  },
  toJSON() {
    fire();
    return 1;
  },
  get length() {
    fire();
    return 1;
  },
  get 0() {
    fire();
    return 1;
  },
  get k() {
    fire();
    return 1;
  },
  get then() {
    fire();
    return undefined;
  },
  [Symbol.iterator]() {
    fire();
    return [[1, 1]][Symbol.iterator]();
  },
});
const traps = new Proxy({}, {
  get: (handler, trap) => (...list) => {
    fire();
    return Reflect[trap](...list);
  },
});
const trapped = () => new Proxy({}, traps);
const trappedFunction = () => new Proxy(function () {}, traps);

function observe(label, use, operand) {
  const o = { x: 1, y: "same" };
  const a = ["same", 2];
  shared = "same";
  let fired = 0;
  fire = () => {
    fired++;
    o.y = "changed";
    a[0] = "changed";
    shared = "changed";
  };
  const line = outcome(() => use(o, a, operand()));
  fire = () => {};
  console.log(label + " -> " + line + ", ran " + fired + " times, now " + [o.y, a[0], shared].join(" "));
}

function around1(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.prototype.propertyIsEnumerable.call({}, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around2(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.prototype.isPrototypeOf.call({}, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around3(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.prototype.valueOf.call(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around4(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (JSON.stringify(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around5(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (JSON.stringify({ k: t }));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around6(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (JSON.stringify([t]));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around7(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (JSON.stringify({ a: 1 }, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around8(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (JSON.stringify({ a: 1 }, null, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around9(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (JSON.parse(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around10(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (JSON.parse("1", t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around11(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Reflect.get(t, "k"));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around12(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Reflect.get({}, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around13(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Reflect.get({ get k() { return this.j; } }, "k", t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around14(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Reflect.set(t, "k", 1));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around15(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Reflect.set({}, "k", 1, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around16(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Reflect.has(t, "k"));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around17(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Reflect.has({}, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around18(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Reflect.ownKeys(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around19(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Reflect.getPrototypeOf(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around20(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Reflect.setPrototypeOf(t, null));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around21(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Reflect.isExtensible(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around22(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Reflect.preventExtensions(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around23(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Reflect.deleteProperty(t, "k"));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around24(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Reflect.defineProperty({}, "k", t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around25(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Reflect.getOwnPropertyDescriptor(t, "k"));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around26(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Reflect.apply(Math.max, null, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around27(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Reflect.construct(Object, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around28(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Reflect.construct(Object, [], t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around29(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Math.max.apply(null, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around30(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Math.max.call(null, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around31(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Math.max.bind(null, t)());
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around32(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Function.prototype.bind.call(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around33(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Function.prototype.toString.call(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around34(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Function.prototype[Symbol.hasInstance].call(Object, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around35(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Map(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around36(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Map([t]));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around37(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Map().get(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around38(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Map().set(t, 1));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around39(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Set(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around40(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Set().add(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

console.log("strict:", (function () { return this === undefined; })());
observe("Object.prototype.propertyIsEnumerable.call({}, t)" + " with a number", around1, () => 1);
observe("Object.prototype.propertyIsEnumerable.call({}, t)" + " with methods", around1, withMethods);
observe("Object.prototype.propertyIsEnumerable.call({}, t)" + " with a proxy", around1, trapped);
observe("Object.prototype.propertyIsEnumerable.call({}, t)" + " with a proxy of a function", around1, trappedFunction);
observe("Object.prototype.isPrototypeOf.call({}, t)" + " with a number", around2, () => 1);
observe("Object.prototype.isPrototypeOf.call({}, t)" + " with methods", around2, withMethods);
observe("Object.prototype.isPrototypeOf.call({}, t)" + " with a proxy", around2, trapped);
observe("Object.prototype.isPrototypeOf.call({}, t)" + " with a proxy of a function", around2, trappedFunction);
observe("Object.prototype.valueOf.call(t)" + " with a number", around3, () => 1);
observe("Object.prototype.valueOf.call(t)" + " with methods", around3, withMethods);
observe("Object.prototype.valueOf.call(t)" + " with a proxy", around3, trapped);
observe("Object.prototype.valueOf.call(t)" + " with a proxy of a function", around3, trappedFunction);
observe("JSON.stringify(t)" + " with a number", around4, () => 1);
observe("JSON.stringify(t)" + " with methods", around4, withMethods);
observe("JSON.stringify(t)" + " with a proxy", around4, trapped);
observe("JSON.stringify(t)" + " with a proxy of a function", around4, trappedFunction);
observe("JSON.stringify({ k: t })" + " with a number", around5, () => 1);
observe("JSON.stringify({ k: t })" + " with methods", around5, withMethods);
observe("JSON.stringify({ k: t })" + " with a proxy", around5, trapped);
observe("JSON.stringify({ k: t })" + " with a proxy of a function", around5, trappedFunction);
observe("JSON.stringify([t])" + " with a number", around6, () => 1);
observe("JSON.stringify([t])" + " with methods", around6, withMethods);
observe("JSON.stringify([t])" + " with a proxy", around6, trapped);
observe("JSON.stringify([t])" + " with a proxy of a function", around6, trappedFunction);
observe("JSON.stringify({ a: 1 }, t)" + " with a number", around7, () => 1);
observe("JSON.stringify({ a: 1 }, t)" + " with methods", around7, withMethods);
observe("JSON.stringify({ a: 1 }, t)" + " with a proxy", around7, trapped);
observe("JSON.stringify({ a: 1 }, t)" + " with a proxy of a function", around7, trappedFunction);
observe("JSON.stringify({ a: 1 }, null, t)" + " with a number", around8, () => 1);
observe("JSON.stringify({ a: 1 }, null, t)" + " with methods", around8, withMethods);
observe("JSON.stringify({ a: 1 }, null, t)" + " with a proxy", around8, trapped);
observe("JSON.stringify({ a: 1 }, null, t)" + " with a proxy of a function", around8, trappedFunction);
observe("JSON.parse(t)" + " with a number", around9, () => 1);
observe("JSON.parse(t)" + " with methods", around9, withMethods);
observe("JSON.parse(t)" + " with a proxy", around9, trapped);
observe("JSON.parse(t)" + " with a proxy of a function", around9, trappedFunction);
observe("JSON.parse(\"1\", t)" + " with a number", around10, () => 1);
observe("JSON.parse(\"1\", t)" + " with methods", around10, withMethods);
observe("JSON.parse(\"1\", t)" + " with a proxy", around10, trapped);
observe("JSON.parse(\"1\", t)" + " with a proxy of a function", around10, trappedFunction);
observe("Reflect.get(t, \"k\")" + " with a number", around11, () => 1);
observe("Reflect.get(t, \"k\")" + " with methods", around11, withMethods);
observe("Reflect.get(t, \"k\")" + " with a proxy", around11, trapped);
observe("Reflect.get(t, \"k\")" + " with a proxy of a function", around11, trappedFunction);
observe("Reflect.get({}, t)" + " with a number", around12, () => 1);
observe("Reflect.get({}, t)" + " with methods", around12, withMethods);
observe("Reflect.get({}, t)" + " with a proxy", around12, trapped);
observe("Reflect.get({}, t)" + " with a proxy of a function", around12, trappedFunction);
observe("Reflect.get({ get k() { return this.j; } }, \"k\", t)" + " with a number", around13, () => 1);
observe("Reflect.get({ get k() { return this.j; } }, \"k\", t)" + " with methods", around13, withMethods);
observe("Reflect.get({ get k() { return this.j; } }, \"k\", t)" + " with a proxy", around13, trapped);
observe("Reflect.get({ get k() { return this.j; } }, \"k\", t)" + " with a proxy of a function", around13, trappedFunction);
observe("Reflect.set(t, \"k\", 1)" + " with a number", around14, () => 1);
observe("Reflect.set(t, \"k\", 1)" + " with methods", around14, withMethods);
observe("Reflect.set(t, \"k\", 1)" + " with a proxy", around14, trapped);
observe("Reflect.set(t, \"k\", 1)" + " with a proxy of a function", around14, trappedFunction);
observe("Reflect.set({}, \"k\", 1, t)" + " with a number", around15, () => 1);
observe("Reflect.set({}, \"k\", 1, t)" + " with methods", around15, withMethods);
observe("Reflect.set({}, \"k\", 1, t)" + " with a proxy", around15, trapped);
observe("Reflect.set({}, \"k\", 1, t)" + " with a proxy of a function", around15, trappedFunction);
observe("Reflect.has(t, \"k\")" + " with a number", around16, () => 1);
observe("Reflect.has(t, \"k\")" + " with methods", around16, withMethods);
observe("Reflect.has(t, \"k\")" + " with a proxy", around16, trapped);
observe("Reflect.has(t, \"k\")" + " with a proxy of a function", around16, trappedFunction);
observe("Reflect.has({}, t)" + " with a number", around17, () => 1);
observe("Reflect.has({}, t)" + " with methods", around17, withMethods);
observe("Reflect.has({}, t)" + " with a proxy", around17, trapped);
observe("Reflect.has({}, t)" + " with a proxy of a function", around17, trappedFunction);
observe("Reflect.ownKeys(t)" + " with a number", around18, () => 1);
observe("Reflect.ownKeys(t)" + " with methods", around18, withMethods);
observe("Reflect.ownKeys(t)" + " with a proxy", around18, trapped);
observe("Reflect.ownKeys(t)" + " with a proxy of a function", around18, trappedFunction);
observe("Reflect.getPrototypeOf(t)" + " with a number", around19, () => 1);
observe("Reflect.getPrototypeOf(t)" + " with methods", around19, withMethods);
observe("Reflect.getPrototypeOf(t)" + " with a proxy", around19, trapped);
observe("Reflect.getPrototypeOf(t)" + " with a proxy of a function", around19, trappedFunction);
observe("Reflect.setPrototypeOf(t, null)" + " with a number", around20, () => 1);
observe("Reflect.setPrototypeOf(t, null)" + " with methods", around20, withMethods);
observe("Reflect.setPrototypeOf(t, null)" + " with a proxy", around20, trapped);
observe("Reflect.setPrototypeOf(t, null)" + " with a proxy of a function", around20, trappedFunction);
observe("Reflect.isExtensible(t)" + " with a number", around21, () => 1);
observe("Reflect.isExtensible(t)" + " with methods", around21, withMethods);
observe("Reflect.isExtensible(t)" + " with a proxy", around21, trapped);
observe("Reflect.isExtensible(t)" + " with a proxy of a function", around21, trappedFunction);
observe("Reflect.preventExtensions(t)" + " with a number", around22, () => 1);
observe("Reflect.preventExtensions(t)" + " with methods", around22, withMethods);
observe("Reflect.preventExtensions(t)" + " with a proxy", around22, trapped);
observe("Reflect.preventExtensions(t)" + " with a proxy of a function", around22, trappedFunction);
observe("Reflect.deleteProperty(t, \"k\")" + " with a number", around23, () => 1);
observe("Reflect.deleteProperty(t, \"k\")" + " with methods", around23, withMethods);
observe("Reflect.deleteProperty(t, \"k\")" + " with a proxy", around23, trapped);
observe("Reflect.deleteProperty(t, \"k\")" + " with a proxy of a function", around23, trappedFunction);
observe("Reflect.defineProperty({}, \"k\", t)" + " with a number", around24, () => 1);
observe("Reflect.defineProperty({}, \"k\", t)" + " with methods", around24, withMethods);
observe("Reflect.defineProperty({}, \"k\", t)" + " with a proxy", around24, trapped);
observe("Reflect.defineProperty({}, \"k\", t)" + " with a proxy of a function", around24, trappedFunction);
observe("Reflect.getOwnPropertyDescriptor(t, \"k\")" + " with a number", around25, () => 1);
observe("Reflect.getOwnPropertyDescriptor(t, \"k\")" + " with methods", around25, withMethods);
observe("Reflect.getOwnPropertyDescriptor(t, \"k\")" + " with a proxy", around25, trapped);
observe("Reflect.getOwnPropertyDescriptor(t, \"k\")" + " with a proxy of a function", around25, trappedFunction);
observe("Reflect.apply(Math.max, null, t)" + " with a number", around26, () => 1);
observe("Reflect.apply(Math.max, null, t)" + " with methods", around26, withMethods);
observe("Reflect.apply(Math.max, null, t)" + " with a proxy", around26, trapped);
observe("Reflect.apply(Math.max, null, t)" + " with a proxy of a function", around26, trappedFunction);
observe("Reflect.construct(Object, t)" + " with a number", around27, () => 1);
observe("Reflect.construct(Object, t)" + " with methods", around27, withMethods);
observe("Reflect.construct(Object, t)" + " with a proxy", around27, trapped);
observe("Reflect.construct(Object, t)" + " with a proxy of a function", around27, trappedFunction);
observe("Reflect.construct(Object, [], t)" + " with a number", around28, () => 1);
observe("Reflect.construct(Object, [], t)" + " with methods", around28, withMethods);
observe("Reflect.construct(Object, [], t)" + " with a proxy", around28, trapped);
observe("Reflect.construct(Object, [], t)" + " with a proxy of a function", around28, trappedFunction);
observe("Math.max.apply(null, t)" + " with a number", around29, () => 1);
observe("Math.max.apply(null, t)" + " with methods", around29, withMethods);
observe("Math.max.apply(null, t)" + " with a proxy", around29, trapped);
observe("Math.max.apply(null, t)" + " with a proxy of a function", around29, trappedFunction);
observe("Math.max.call(null, t)" + " with a number", around30, () => 1);
observe("Math.max.call(null, t)" + " with methods", around30, withMethods);
observe("Math.max.call(null, t)" + " with a proxy", around30, trapped);
observe("Math.max.call(null, t)" + " with a proxy of a function", around30, trappedFunction);
observe("Math.max.bind(null, t)()" + " with a number", around31, () => 1);
observe("Math.max.bind(null, t)()" + " with methods", around31, withMethods);
observe("Math.max.bind(null, t)()" + " with a proxy", around31, trapped);
observe("Math.max.bind(null, t)()" + " with a proxy of a function", around31, trappedFunction);
observe("Function.prototype.bind.call(t)" + " with a number", around32, () => 1);
observe("Function.prototype.bind.call(t)" + " with methods", around32, withMethods);
observe("Function.prototype.bind.call(t)" + " with a proxy", around32, trapped);
observe("Function.prototype.bind.call(t)" + " with a proxy of a function", around32, trappedFunction);
observe("Function.prototype.toString.call(t)" + " with a number", around33, () => 1);
observe("Function.prototype.toString.call(t)" + " with methods", around33, withMethods);
observe("Function.prototype.toString.call(t)" + " with a proxy", around33, trapped);
observe("Function.prototype.toString.call(t)" + " with a proxy of a function", around33, trappedFunction);
observe("Function.prototype[Symbol.hasInstance].call(Object, t)" + " with a number", around34, () => 1);
observe("Function.prototype[Symbol.hasInstance].call(Object, t)" + " with methods", around34, withMethods);
observe("Function.prototype[Symbol.hasInstance].call(Object, t)" + " with a proxy", around34, trapped);
observe("Function.prototype[Symbol.hasInstance].call(Object, t)" + " with a proxy of a function", around34, trappedFunction);
observe("new Map(t)" + " with a number", around35, () => 1);
observe("new Map(t)" + " with methods", around35, withMethods);
observe("new Map(t)" + " with a proxy", around35, trapped);
observe("new Map(t)" + " with a proxy of a function", around35, trappedFunction);
observe("new Map([t])" + " with a number", around36, () => 1);
observe("new Map([t])" + " with methods", around36, withMethods);
observe("new Map([t])" + " with a proxy", around36, trapped);
observe("new Map([t])" + " with a proxy of a function", around36, trappedFunction);
observe("new Map().get(t)" + " with a number", around37, () => 1);
observe("new Map().get(t)" + " with methods", around37, withMethods);
observe("new Map().get(t)" + " with a proxy", around37, trapped);
observe("new Map().get(t)" + " with a proxy of a function", around37, trappedFunction);
observe("new Map().set(t, 1)" + " with a number", around38, () => 1);
observe("new Map().set(t, 1)" + " with methods", around38, withMethods);
observe("new Map().set(t, 1)" + " with a proxy", around38, trapped);
observe("new Map().set(t, 1)" + " with a proxy of a function", around38, trappedFunction);
observe("new Set(t)" + " with a number", around39, () => 1);
observe("new Set(t)" + " with methods", around39, withMethods);
observe("new Set(t)" + " with a proxy", around39, trapped);
observe("new Set(t)" + " with a proxy of a function", around39, trappedFunction);
observe("new Set().add(t)" + " with a number", around40, () => 1);
observe("new Set().add(t)" + " with methods", around40, withMethods);
observe("new Set().add(t)" + " with a proxy", around40, trapped);
observe("new Set().add(t)" + " with a proxy of a function", around40, trappedFunction);
