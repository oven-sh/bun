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
  void ((() => { for (const x of t) return x; })());
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around2(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Number(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around3(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (BigInt(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around4(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Boolean(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around5(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (parseInt(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around6(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (parseFloat(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around7(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (isNaN(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around8(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (isFinite(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around9(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Number.isInteger(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around10(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ((1.5).toFixed(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around11(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ((255).toString(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around12(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ((1.5).toPrecision(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around13(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (BigInt.asIntN(t, 1n));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around14(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Math.max(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around15(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Math.min(1, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around16(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Math.floor(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around17(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Math.ceil(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around18(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Math.round(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around19(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Math.trunc(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around20(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Math.abs(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around21(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Math.sign(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around22(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Math.sqrt(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around23(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Math.pow(t, 2));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around24(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Math.pow(2, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around25(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Math.imul(t, 2));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around26(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Math.clz32(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around27(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Math.fround(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around28(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Math.hypot(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around29(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Math.atan2(1, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around30(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Math.log2(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around31(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Math.sin(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

console.log("strict:", (function () { return this === undefined; })());
observe("(() => { for (const x of t) return x; })()" + " with a number", around1, () => 1);
observe("(() => { for (const x of t) return x; })()" + " with methods", around1, withMethods);
observe("(() => { for (const x of t) return x; })()" + " with a proxy", around1, trapped);
observe("(() => { for (const x of t) return x; })()" + " with a proxy of a function", around1, trappedFunction);
observe("Number(t)" + " with a number", around2, () => 1);
observe("Number(t)" + " with methods", around2, withMethods);
observe("Number(t)" + " with a proxy", around2, trapped);
observe("Number(t)" + " with a proxy of a function", around2, trappedFunction);
observe("BigInt(t)" + " with a number", around3, () => 1);
observe("BigInt(t)" + " with methods", around3, withMethods);
observe("BigInt(t)" + " with a proxy", around3, trapped);
observe("BigInt(t)" + " with a proxy of a function", around3, trappedFunction);
observe("Boolean(t)" + " with a number", around4, () => 1);
observe("Boolean(t)" + " with methods", around4, withMethods);
observe("Boolean(t)" + " with a proxy", around4, trapped);
observe("Boolean(t)" + " with a proxy of a function", around4, trappedFunction);
observe("parseInt(t)" + " with a number", around5, () => 1);
observe("parseInt(t)" + " with methods", around5, withMethods);
observe("parseInt(t)" + " with a proxy", around5, trapped);
observe("parseInt(t)" + " with a proxy of a function", around5, trappedFunction);
observe("parseFloat(t)" + " with a number", around6, () => 1);
observe("parseFloat(t)" + " with methods", around6, withMethods);
observe("parseFloat(t)" + " with a proxy", around6, trapped);
observe("parseFloat(t)" + " with a proxy of a function", around6, trappedFunction);
observe("isNaN(t)" + " with a number", around7, () => 1);
observe("isNaN(t)" + " with methods", around7, withMethods);
observe("isNaN(t)" + " with a proxy", around7, trapped);
observe("isNaN(t)" + " with a proxy of a function", around7, trappedFunction);
observe("isFinite(t)" + " with a number", around8, () => 1);
observe("isFinite(t)" + " with methods", around8, withMethods);
observe("isFinite(t)" + " with a proxy", around8, trapped);
observe("isFinite(t)" + " with a proxy of a function", around8, trappedFunction);
observe("Number.isInteger(t)" + " with a number", around9, () => 1);
observe("Number.isInteger(t)" + " with methods", around9, withMethods);
observe("Number.isInteger(t)" + " with a proxy", around9, trapped);
observe("Number.isInteger(t)" + " with a proxy of a function", around9, trappedFunction);
observe("(1.5).toFixed(t)" + " with a number", around10, () => 1);
observe("(1.5).toFixed(t)" + " with methods", around10, withMethods);
observe("(1.5).toFixed(t)" + " with a proxy", around10, trapped);
observe("(1.5).toFixed(t)" + " with a proxy of a function", around10, trappedFunction);
observe("(255).toString(t)" + " with a number", around11, () => 1);
observe("(255).toString(t)" + " with methods", around11, withMethods);
observe("(255).toString(t)" + " with a proxy", around11, trapped);
observe("(255).toString(t)" + " with a proxy of a function", around11, trappedFunction);
observe("(1.5).toPrecision(t)" + " with a number", around12, () => 1);
observe("(1.5).toPrecision(t)" + " with methods", around12, withMethods);
observe("(1.5).toPrecision(t)" + " with a proxy", around12, trapped);
observe("(1.5).toPrecision(t)" + " with a proxy of a function", around12, trappedFunction);
observe("BigInt.asIntN(t, 1n)" + " with a number", around13, () => 1);
observe("BigInt.asIntN(t, 1n)" + " with methods", around13, withMethods);
observe("BigInt.asIntN(t, 1n)" + " with a proxy", around13, trapped);
observe("BigInt.asIntN(t, 1n)" + " with a proxy of a function", around13, trappedFunction);
observe("Math.max(t)" + " with a number", around14, () => 1);
observe("Math.max(t)" + " with methods", around14, withMethods);
observe("Math.max(t)" + " with a proxy", around14, trapped);
observe("Math.max(t)" + " with a proxy of a function", around14, trappedFunction);
observe("Math.min(1, t)" + " with a number", around15, () => 1);
observe("Math.min(1, t)" + " with methods", around15, withMethods);
observe("Math.min(1, t)" + " with a proxy", around15, trapped);
observe("Math.min(1, t)" + " with a proxy of a function", around15, trappedFunction);
observe("Math.floor(t)" + " with a number", around16, () => 1);
observe("Math.floor(t)" + " with methods", around16, withMethods);
observe("Math.floor(t)" + " with a proxy", around16, trapped);
observe("Math.floor(t)" + " with a proxy of a function", around16, trappedFunction);
observe("Math.ceil(t)" + " with a number", around17, () => 1);
observe("Math.ceil(t)" + " with methods", around17, withMethods);
observe("Math.ceil(t)" + " with a proxy", around17, trapped);
observe("Math.ceil(t)" + " with a proxy of a function", around17, trappedFunction);
observe("Math.round(t)" + " with a number", around18, () => 1);
observe("Math.round(t)" + " with methods", around18, withMethods);
observe("Math.round(t)" + " with a proxy", around18, trapped);
observe("Math.round(t)" + " with a proxy of a function", around18, trappedFunction);
observe("Math.trunc(t)" + " with a number", around19, () => 1);
observe("Math.trunc(t)" + " with methods", around19, withMethods);
observe("Math.trunc(t)" + " with a proxy", around19, trapped);
observe("Math.trunc(t)" + " with a proxy of a function", around19, trappedFunction);
observe("Math.abs(t)" + " with a number", around20, () => 1);
observe("Math.abs(t)" + " with methods", around20, withMethods);
observe("Math.abs(t)" + " with a proxy", around20, trapped);
observe("Math.abs(t)" + " with a proxy of a function", around20, trappedFunction);
observe("Math.sign(t)" + " with a number", around21, () => 1);
observe("Math.sign(t)" + " with methods", around21, withMethods);
observe("Math.sign(t)" + " with a proxy", around21, trapped);
observe("Math.sign(t)" + " with a proxy of a function", around21, trappedFunction);
observe("Math.sqrt(t)" + " with a number", around22, () => 1);
observe("Math.sqrt(t)" + " with methods", around22, withMethods);
observe("Math.sqrt(t)" + " with a proxy", around22, trapped);
observe("Math.sqrt(t)" + " with a proxy of a function", around22, trappedFunction);
observe("Math.pow(t, 2)" + " with a number", around23, () => 1);
observe("Math.pow(t, 2)" + " with methods", around23, withMethods);
observe("Math.pow(t, 2)" + " with a proxy", around23, trapped);
observe("Math.pow(t, 2)" + " with a proxy of a function", around23, trappedFunction);
observe("Math.pow(2, t)" + " with a number", around24, () => 1);
observe("Math.pow(2, t)" + " with methods", around24, withMethods);
observe("Math.pow(2, t)" + " with a proxy", around24, trapped);
observe("Math.pow(2, t)" + " with a proxy of a function", around24, trappedFunction);
observe("Math.imul(t, 2)" + " with a number", around25, () => 1);
observe("Math.imul(t, 2)" + " with methods", around25, withMethods);
observe("Math.imul(t, 2)" + " with a proxy", around25, trapped);
observe("Math.imul(t, 2)" + " with a proxy of a function", around25, trappedFunction);
observe("Math.clz32(t)" + " with a number", around26, () => 1);
observe("Math.clz32(t)" + " with methods", around26, withMethods);
observe("Math.clz32(t)" + " with a proxy", around26, trapped);
observe("Math.clz32(t)" + " with a proxy of a function", around26, trappedFunction);
observe("Math.fround(t)" + " with a number", around27, () => 1);
observe("Math.fround(t)" + " with methods", around27, withMethods);
observe("Math.fround(t)" + " with a proxy", around27, trapped);
observe("Math.fround(t)" + " with a proxy of a function", around27, trappedFunction);
observe("Math.hypot(t)" + " with a number", around28, () => 1);
observe("Math.hypot(t)" + " with methods", around28, withMethods);
observe("Math.hypot(t)" + " with a proxy", around28, trapped);
observe("Math.hypot(t)" + " with a proxy of a function", around28, trappedFunction);
observe("Math.atan2(1, t)" + " with a number", around29, () => 1);
observe("Math.atan2(1, t)" + " with methods", around29, withMethods);
observe("Math.atan2(1, t)" + " with a proxy", around29, trapped);
observe("Math.atan2(1, t)" + " with a proxy of a function", around29, trappedFunction);
observe("Math.log2(t)" + " with a number", around30, () => 1);
observe("Math.log2(t)" + " with methods", around30, withMethods);
observe("Math.log2(t)" + " with a proxy", around30, trapped);
observe("Math.log2(t)" + " with a proxy of a function", around30, trappedFunction);
observe("Math.sin(t)" + " with a number", around31, () => 1);
observe("Math.sin(t)" + " with methods", around31, withMethods);
observe("Math.sin(t)" + " with a proxy", around31, trapped);
observe("Math.sin(t)" + " with a proxy of a function", around31, trappedFunction);
