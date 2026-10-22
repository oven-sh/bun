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
  void (Object.keys(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around2(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.values(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around3(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.entries(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around4(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.assign({}, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around5(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.assign(t, { k: 1 }));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around6(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.getOwnPropertyNames(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around7(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.getOwnPropertySymbols(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around8(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.getOwnPropertyDescriptor(t, "k"));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around9(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.getOwnPropertyDescriptor({}, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around10(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.getOwnPropertyDescriptors(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around11(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.defineProperty({}, "k", t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around12(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.defineProperty({}, t, {}));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around13(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.defineProperty(t, "k", {}));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around14(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.defineProperties({}, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around15(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.defineProperties({}, { k: t }));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around16(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.create(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around17(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.create(null, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around18(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.create(null, { k: t }));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around19(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.freeze(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around20(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.seal(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around21(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.preventExtensions(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around22(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.isFrozen(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around23(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.isSealed(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around24(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.isExtensible(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around25(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.getPrototypeOf(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around26(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.setPrototypeOf(t, null));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around27(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.setPrototypeOf({}, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around28(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.fromEntries(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around29(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.fromEntries([[t, 1]]));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around30(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.fromEntries([t]));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around31(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.hasOwn(t, "k"));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around32(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.hasOwn({}, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around33(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.is(t, 1));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around34(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.groupBy(t, x => x));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around35(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.groupBy([1], () => t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around36(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around37(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.prototype.hasOwnProperty.call({}, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around38(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.prototype.hasOwnProperty.call(t, "k"));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around39(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.prototype.toString.call(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around40(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Object.prototype.toLocaleString.call(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

console.log("strict:", (function () { return this === undefined; })());
observe("Object.keys(t)" + " with a number", around1, () => 1);
observe("Object.keys(t)" + " with methods", around1, withMethods);
observe("Object.keys(t)" + " with a proxy", around1, trapped);
observe("Object.keys(t)" + " with a proxy of a function", around1, trappedFunction);
observe("Object.values(t)" + " with a number", around2, () => 1);
observe("Object.values(t)" + " with methods", around2, withMethods);
observe("Object.values(t)" + " with a proxy", around2, trapped);
observe("Object.values(t)" + " with a proxy of a function", around2, trappedFunction);
observe("Object.entries(t)" + " with a number", around3, () => 1);
observe("Object.entries(t)" + " with methods", around3, withMethods);
observe("Object.entries(t)" + " with a proxy", around3, trapped);
observe("Object.entries(t)" + " with a proxy of a function", around3, trappedFunction);
observe("Object.assign({}, t)" + " with a number", around4, () => 1);
observe("Object.assign({}, t)" + " with methods", around4, withMethods);
observe("Object.assign({}, t)" + " with a proxy", around4, trapped);
observe("Object.assign({}, t)" + " with a proxy of a function", around4, trappedFunction);
observe("Object.assign(t, { k: 1 })" + " with a number", around5, () => 1);
observe("Object.assign(t, { k: 1 })" + " with methods", around5, withMethods);
observe("Object.assign(t, { k: 1 })" + " with a proxy", around5, trapped);
observe("Object.assign(t, { k: 1 })" + " with a proxy of a function", around5, trappedFunction);
observe("Object.getOwnPropertyNames(t)" + " with a number", around6, () => 1);
observe("Object.getOwnPropertyNames(t)" + " with methods", around6, withMethods);
observe("Object.getOwnPropertyNames(t)" + " with a proxy", around6, trapped);
observe("Object.getOwnPropertyNames(t)" + " with a proxy of a function", around6, trappedFunction);
observe("Object.getOwnPropertySymbols(t)" + " with a number", around7, () => 1);
observe("Object.getOwnPropertySymbols(t)" + " with methods", around7, withMethods);
observe("Object.getOwnPropertySymbols(t)" + " with a proxy", around7, trapped);
observe("Object.getOwnPropertySymbols(t)" + " with a proxy of a function", around7, trappedFunction);
observe("Object.getOwnPropertyDescriptor(t, \"k\")" + " with a number", around8, () => 1);
observe("Object.getOwnPropertyDescriptor(t, \"k\")" + " with methods", around8, withMethods);
observe("Object.getOwnPropertyDescriptor(t, \"k\")" + " with a proxy", around8, trapped);
observe("Object.getOwnPropertyDescriptor(t, \"k\")" + " with a proxy of a function", around8, trappedFunction);
observe("Object.getOwnPropertyDescriptor({}, t)" + " with a number", around9, () => 1);
observe("Object.getOwnPropertyDescriptor({}, t)" + " with methods", around9, withMethods);
observe("Object.getOwnPropertyDescriptor({}, t)" + " with a proxy", around9, trapped);
observe("Object.getOwnPropertyDescriptor({}, t)" + " with a proxy of a function", around9, trappedFunction);
observe("Object.getOwnPropertyDescriptors(t)" + " with a number", around10, () => 1);
observe("Object.getOwnPropertyDescriptors(t)" + " with methods", around10, withMethods);
observe("Object.getOwnPropertyDescriptors(t)" + " with a proxy", around10, trapped);
observe("Object.getOwnPropertyDescriptors(t)" + " with a proxy of a function", around10, trappedFunction);
observe("Object.defineProperty({}, \"k\", t)" + " with a number", around11, () => 1);
observe("Object.defineProperty({}, \"k\", t)" + " with methods", around11, withMethods);
observe("Object.defineProperty({}, \"k\", t)" + " with a proxy", around11, trapped);
observe("Object.defineProperty({}, \"k\", t)" + " with a proxy of a function", around11, trappedFunction);
observe("Object.defineProperty({}, t, {})" + " with a number", around12, () => 1);
observe("Object.defineProperty({}, t, {})" + " with methods", around12, withMethods);
observe("Object.defineProperty({}, t, {})" + " with a proxy", around12, trapped);
observe("Object.defineProperty({}, t, {})" + " with a proxy of a function", around12, trappedFunction);
observe("Object.defineProperty(t, \"k\", {})" + " with a number", around13, () => 1);
observe("Object.defineProperty(t, \"k\", {})" + " with methods", around13, withMethods);
observe("Object.defineProperty(t, \"k\", {})" + " with a proxy", around13, trapped);
observe("Object.defineProperty(t, \"k\", {})" + " with a proxy of a function", around13, trappedFunction);
observe("Object.defineProperties({}, t)" + " with a number", around14, () => 1);
observe("Object.defineProperties({}, t)" + " with methods", around14, withMethods);
observe("Object.defineProperties({}, t)" + " with a proxy", around14, trapped);
observe("Object.defineProperties({}, t)" + " with a proxy of a function", around14, trappedFunction);
observe("Object.defineProperties({}, { k: t })" + " with a number", around15, () => 1);
observe("Object.defineProperties({}, { k: t })" + " with methods", around15, withMethods);
observe("Object.defineProperties({}, { k: t })" + " with a proxy", around15, trapped);
observe("Object.defineProperties({}, { k: t })" + " with a proxy of a function", around15, trappedFunction);
observe("Object.create(t)" + " with a number", around16, () => 1);
observe("Object.create(t)" + " with methods", around16, withMethods);
observe("Object.create(t)" + " with a proxy", around16, trapped);
observe("Object.create(t)" + " with a proxy of a function", around16, trappedFunction);
observe("Object.create(null, t)" + " with a number", around17, () => 1);
observe("Object.create(null, t)" + " with methods", around17, withMethods);
observe("Object.create(null, t)" + " with a proxy", around17, trapped);
observe("Object.create(null, t)" + " with a proxy of a function", around17, trappedFunction);
observe("Object.create(null, { k: t })" + " with a number", around18, () => 1);
observe("Object.create(null, { k: t })" + " with methods", around18, withMethods);
observe("Object.create(null, { k: t })" + " with a proxy", around18, trapped);
observe("Object.create(null, { k: t })" + " with a proxy of a function", around18, trappedFunction);
observe("Object.freeze(t)" + " with a number", around19, () => 1);
observe("Object.freeze(t)" + " with methods", around19, withMethods);
observe("Object.freeze(t)" + " with a proxy", around19, trapped);
observe("Object.freeze(t)" + " with a proxy of a function", around19, trappedFunction);
observe("Object.seal(t)" + " with a number", around20, () => 1);
observe("Object.seal(t)" + " with methods", around20, withMethods);
observe("Object.seal(t)" + " with a proxy", around20, trapped);
observe("Object.seal(t)" + " with a proxy of a function", around20, trappedFunction);
observe("Object.preventExtensions(t)" + " with a number", around21, () => 1);
observe("Object.preventExtensions(t)" + " with methods", around21, withMethods);
observe("Object.preventExtensions(t)" + " with a proxy", around21, trapped);
observe("Object.preventExtensions(t)" + " with a proxy of a function", around21, trappedFunction);
observe("Object.isFrozen(t)" + " with a number", around22, () => 1);
observe("Object.isFrozen(t)" + " with methods", around22, withMethods);
observe("Object.isFrozen(t)" + " with a proxy", around22, trapped);
observe("Object.isFrozen(t)" + " with a proxy of a function", around22, trappedFunction);
observe("Object.isSealed(t)" + " with a number", around23, () => 1);
observe("Object.isSealed(t)" + " with methods", around23, withMethods);
observe("Object.isSealed(t)" + " with a proxy", around23, trapped);
observe("Object.isSealed(t)" + " with a proxy of a function", around23, trappedFunction);
observe("Object.isExtensible(t)" + " with a number", around24, () => 1);
observe("Object.isExtensible(t)" + " with methods", around24, withMethods);
observe("Object.isExtensible(t)" + " with a proxy", around24, trapped);
observe("Object.isExtensible(t)" + " with a proxy of a function", around24, trappedFunction);
observe("Object.getPrototypeOf(t)" + " with a number", around25, () => 1);
observe("Object.getPrototypeOf(t)" + " with methods", around25, withMethods);
observe("Object.getPrototypeOf(t)" + " with a proxy", around25, trapped);
observe("Object.getPrototypeOf(t)" + " with a proxy of a function", around25, trappedFunction);
observe("Object.setPrototypeOf(t, null)" + " with a number", around26, () => 1);
observe("Object.setPrototypeOf(t, null)" + " with methods", around26, withMethods);
observe("Object.setPrototypeOf(t, null)" + " with a proxy", around26, trapped);
observe("Object.setPrototypeOf(t, null)" + " with a proxy of a function", around26, trappedFunction);
observe("Object.setPrototypeOf({}, t)" + " with a number", around27, () => 1);
observe("Object.setPrototypeOf({}, t)" + " with methods", around27, withMethods);
observe("Object.setPrototypeOf({}, t)" + " with a proxy", around27, trapped);
observe("Object.setPrototypeOf({}, t)" + " with a proxy of a function", around27, trappedFunction);
observe("Object.fromEntries(t)" + " with a number", around28, () => 1);
observe("Object.fromEntries(t)" + " with methods", around28, withMethods);
observe("Object.fromEntries(t)" + " with a proxy", around28, trapped);
observe("Object.fromEntries(t)" + " with a proxy of a function", around28, trappedFunction);
observe("Object.fromEntries([[t, 1]])" + " with a number", around29, () => 1);
observe("Object.fromEntries([[t, 1]])" + " with methods", around29, withMethods);
observe("Object.fromEntries([[t, 1]])" + " with a proxy", around29, trapped);
observe("Object.fromEntries([[t, 1]])" + " with a proxy of a function", around29, trappedFunction);
observe("Object.fromEntries([t])" + " with a number", around30, () => 1);
observe("Object.fromEntries([t])" + " with methods", around30, withMethods);
observe("Object.fromEntries([t])" + " with a proxy", around30, trapped);
observe("Object.fromEntries([t])" + " with a proxy of a function", around30, trappedFunction);
observe("Object.hasOwn(t, \"k\")" + " with a number", around31, () => 1);
observe("Object.hasOwn(t, \"k\")" + " with methods", around31, withMethods);
observe("Object.hasOwn(t, \"k\")" + " with a proxy", around31, trapped);
observe("Object.hasOwn(t, \"k\")" + " with a proxy of a function", around31, trappedFunction);
observe("Object.hasOwn({}, t)" + " with a number", around32, () => 1);
observe("Object.hasOwn({}, t)" + " with methods", around32, withMethods);
observe("Object.hasOwn({}, t)" + " with a proxy", around32, trapped);
observe("Object.hasOwn({}, t)" + " with a proxy of a function", around32, trappedFunction);
observe("Object.is(t, 1)" + " with a number", around33, () => 1);
observe("Object.is(t, 1)" + " with methods", around33, withMethods);
observe("Object.is(t, 1)" + " with a proxy", around33, trapped);
observe("Object.is(t, 1)" + " with a proxy of a function", around33, trappedFunction);
observe("Object.groupBy(t, x => x)" + " with a number", around34, () => 1);
observe("Object.groupBy(t, x => x)" + " with methods", around34, withMethods);
observe("Object.groupBy(t, x => x)" + " with a proxy", around34, trapped);
observe("Object.groupBy(t, x => x)" + " with a proxy of a function", around34, trappedFunction);
observe("Object.groupBy([1], () => t)" + " with a number", around35, () => 1);
observe("Object.groupBy([1], () => t)" + " with methods", around35, withMethods);
observe("Object.groupBy([1], () => t)" + " with a proxy", around35, trapped);
observe("Object.groupBy([1], () => t)" + " with a proxy of a function", around35, trappedFunction);
observe("Object(t)" + " with a number", around36, () => 1);
observe("Object(t)" + " with methods", around36, withMethods);
observe("Object(t)" + " with a proxy", around36, trapped);
observe("Object(t)" + " with a proxy of a function", around36, trappedFunction);
observe("Object.prototype.hasOwnProperty.call({}, t)" + " with a number", around37, () => 1);
observe("Object.prototype.hasOwnProperty.call({}, t)" + " with methods", around37, withMethods);
observe("Object.prototype.hasOwnProperty.call({}, t)" + " with a proxy", around37, trapped);
observe("Object.prototype.hasOwnProperty.call({}, t)" + " with a proxy of a function", around37, trappedFunction);
observe("Object.prototype.hasOwnProperty.call(t, \"k\")" + " with a number", around38, () => 1);
observe("Object.prototype.hasOwnProperty.call(t, \"k\")" + " with methods", around38, withMethods);
observe("Object.prototype.hasOwnProperty.call(t, \"k\")" + " with a proxy", around38, trapped);
observe("Object.prototype.hasOwnProperty.call(t, \"k\")" + " with a proxy of a function", around38, trappedFunction);
observe("Object.prototype.toString.call(t)" + " with a number", around39, () => 1);
observe("Object.prototype.toString.call(t)" + " with methods", around39, withMethods);
observe("Object.prototype.toString.call(t)" + " with a proxy", around39, trapped);
observe("Object.prototype.toString.call(t)" + " with a proxy of a function", around39, trappedFunction);
observe("Object.prototype.toLocaleString.call(t)" + " with a number", around40, () => 1);
observe("Object.prototype.toLocaleString.call(t)" + " with methods", around40, withMethods);
observe("Object.prototype.toLocaleString.call(t)" + " with a proxy", around40, trapped);
observe("Object.prototype.toLocaleString.call(t)" + " with a proxy of a function", around40, trappedFunction);
