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
  void (String(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around2(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Symbol(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around3(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Symbol.for(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around4(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("abc".charCodeAt(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around5(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("abc".charAt(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around6(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("abc".at(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around7(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("abc".codePointAt(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around8(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("abc".slice(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around9(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("abc".slice(0, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around10(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("abc".substring(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around11(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("abc".substr(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around12(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("abc".indexOf(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around13(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("abc".indexOf("b", t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around14(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("abc".lastIndexOf(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around15(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("abc".includes(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around16(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("abc".startsWith(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around17(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("abc".endsWith(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around18(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("abc".padStart(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around19(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("abc".padEnd(5, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around20(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("abc".repeat(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around21(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("abc".concat(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around22(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("abc".split(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around23(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("abc".split("b", t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around24(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("abc".replace("a", t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around25(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("abc".replace(t, "x"));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around26(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("abc".replaceAll(t, "x"));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around27(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("abc".localeCompare(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around28(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("abc".match(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around29(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("abc".matchAll(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around30(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("abc".search(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around31(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("abc" + t);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

console.log("strict:", (function () { return this === undefined; })());
observe("String(t)" + " with a number", around1, () => 1);
observe("String(t)" + " with methods", around1, withMethods);
observe("String(t)" + " with a proxy", around1, trapped);
observe("String(t)" + " with a proxy of a function", around1, trappedFunction);
observe("Symbol(t)" + " with a number", around2, () => 1);
observe("Symbol(t)" + " with methods", around2, withMethods);
observe("Symbol(t)" + " with a proxy", around2, trapped);
observe("Symbol(t)" + " with a proxy of a function", around2, trappedFunction);
observe("Symbol.for(t)" + " with a number", around3, () => 1);
observe("Symbol.for(t)" + " with methods", around3, withMethods);
observe("Symbol.for(t)" + " with a proxy", around3, trapped);
observe("Symbol.for(t)" + " with a proxy of a function", around3, trappedFunction);
observe("\"abc\".charCodeAt(t)" + " with a number", around4, () => 1);
observe("\"abc\".charCodeAt(t)" + " with methods", around4, withMethods);
observe("\"abc\".charCodeAt(t)" + " with a proxy", around4, trapped);
observe("\"abc\".charCodeAt(t)" + " with a proxy of a function", around4, trappedFunction);
observe("\"abc\".charAt(t)" + " with a number", around5, () => 1);
observe("\"abc\".charAt(t)" + " with methods", around5, withMethods);
observe("\"abc\".charAt(t)" + " with a proxy", around5, trapped);
observe("\"abc\".charAt(t)" + " with a proxy of a function", around5, trappedFunction);
observe("\"abc\".at(t)" + " with a number", around6, () => 1);
observe("\"abc\".at(t)" + " with methods", around6, withMethods);
observe("\"abc\".at(t)" + " with a proxy", around6, trapped);
observe("\"abc\".at(t)" + " with a proxy of a function", around6, trappedFunction);
observe("\"abc\".codePointAt(t)" + " with a number", around7, () => 1);
observe("\"abc\".codePointAt(t)" + " with methods", around7, withMethods);
observe("\"abc\".codePointAt(t)" + " with a proxy", around7, trapped);
observe("\"abc\".codePointAt(t)" + " with a proxy of a function", around7, trappedFunction);
observe("\"abc\".slice(t)" + " with a number", around8, () => 1);
observe("\"abc\".slice(t)" + " with methods", around8, withMethods);
observe("\"abc\".slice(t)" + " with a proxy", around8, trapped);
observe("\"abc\".slice(t)" + " with a proxy of a function", around8, trappedFunction);
observe("\"abc\".slice(0, t)" + " with a number", around9, () => 1);
observe("\"abc\".slice(0, t)" + " with methods", around9, withMethods);
observe("\"abc\".slice(0, t)" + " with a proxy", around9, trapped);
observe("\"abc\".slice(0, t)" + " with a proxy of a function", around9, trappedFunction);
observe("\"abc\".substring(t)" + " with a number", around10, () => 1);
observe("\"abc\".substring(t)" + " with methods", around10, withMethods);
observe("\"abc\".substring(t)" + " with a proxy", around10, trapped);
observe("\"abc\".substring(t)" + " with a proxy of a function", around10, trappedFunction);
observe("\"abc\".substr(t)" + " with a number", around11, () => 1);
observe("\"abc\".substr(t)" + " with methods", around11, withMethods);
observe("\"abc\".substr(t)" + " with a proxy", around11, trapped);
observe("\"abc\".substr(t)" + " with a proxy of a function", around11, trappedFunction);
observe("\"abc\".indexOf(t)" + " with a number", around12, () => 1);
observe("\"abc\".indexOf(t)" + " with methods", around12, withMethods);
observe("\"abc\".indexOf(t)" + " with a proxy", around12, trapped);
observe("\"abc\".indexOf(t)" + " with a proxy of a function", around12, trappedFunction);
observe("\"abc\".indexOf(\"b\", t)" + " with a number", around13, () => 1);
observe("\"abc\".indexOf(\"b\", t)" + " with methods", around13, withMethods);
observe("\"abc\".indexOf(\"b\", t)" + " with a proxy", around13, trapped);
observe("\"abc\".indexOf(\"b\", t)" + " with a proxy of a function", around13, trappedFunction);
observe("\"abc\".lastIndexOf(t)" + " with a number", around14, () => 1);
observe("\"abc\".lastIndexOf(t)" + " with methods", around14, withMethods);
observe("\"abc\".lastIndexOf(t)" + " with a proxy", around14, trapped);
observe("\"abc\".lastIndexOf(t)" + " with a proxy of a function", around14, trappedFunction);
observe("\"abc\".includes(t)" + " with a number", around15, () => 1);
observe("\"abc\".includes(t)" + " with methods", around15, withMethods);
observe("\"abc\".includes(t)" + " with a proxy", around15, trapped);
observe("\"abc\".includes(t)" + " with a proxy of a function", around15, trappedFunction);
observe("\"abc\".startsWith(t)" + " with a number", around16, () => 1);
observe("\"abc\".startsWith(t)" + " with methods", around16, withMethods);
observe("\"abc\".startsWith(t)" + " with a proxy", around16, trapped);
observe("\"abc\".startsWith(t)" + " with a proxy of a function", around16, trappedFunction);
observe("\"abc\".endsWith(t)" + " with a number", around17, () => 1);
observe("\"abc\".endsWith(t)" + " with methods", around17, withMethods);
observe("\"abc\".endsWith(t)" + " with a proxy", around17, trapped);
observe("\"abc\".endsWith(t)" + " with a proxy of a function", around17, trappedFunction);
observe("\"abc\".padStart(t)" + " with a number", around18, () => 1);
observe("\"abc\".padStart(t)" + " with methods", around18, withMethods);
observe("\"abc\".padStart(t)" + " with a proxy", around18, trapped);
observe("\"abc\".padStart(t)" + " with a proxy of a function", around18, trappedFunction);
observe("\"abc\".padEnd(5, t)" + " with a number", around19, () => 1);
observe("\"abc\".padEnd(5, t)" + " with methods", around19, withMethods);
observe("\"abc\".padEnd(5, t)" + " with a proxy", around19, trapped);
observe("\"abc\".padEnd(5, t)" + " with a proxy of a function", around19, trappedFunction);
observe("\"abc\".repeat(t)" + " with a number", around20, () => 1);
observe("\"abc\".repeat(t)" + " with methods", around20, withMethods);
observe("\"abc\".repeat(t)" + " with a proxy", around20, trapped);
observe("\"abc\".repeat(t)" + " with a proxy of a function", around20, trappedFunction);
observe("\"abc\".concat(t)" + " with a number", around21, () => 1);
observe("\"abc\".concat(t)" + " with methods", around21, withMethods);
observe("\"abc\".concat(t)" + " with a proxy", around21, trapped);
observe("\"abc\".concat(t)" + " with a proxy of a function", around21, trappedFunction);
observe("\"abc\".split(t)" + " with a number", around22, () => 1);
observe("\"abc\".split(t)" + " with methods", around22, withMethods);
observe("\"abc\".split(t)" + " with a proxy", around22, trapped);
observe("\"abc\".split(t)" + " with a proxy of a function", around22, trappedFunction);
observe("\"abc\".split(\"b\", t)" + " with a number", around23, () => 1);
observe("\"abc\".split(\"b\", t)" + " with methods", around23, withMethods);
observe("\"abc\".split(\"b\", t)" + " with a proxy", around23, trapped);
observe("\"abc\".split(\"b\", t)" + " with a proxy of a function", around23, trappedFunction);
observe("\"abc\".replace(\"a\", t)" + " with a number", around24, () => 1);
observe("\"abc\".replace(\"a\", t)" + " with methods", around24, withMethods);
observe("\"abc\".replace(\"a\", t)" + " with a proxy", around24, trapped);
observe("\"abc\".replace(\"a\", t)" + " with a proxy of a function", around24, trappedFunction);
observe("\"abc\".replace(t, \"x\")" + " with a number", around25, () => 1);
observe("\"abc\".replace(t, \"x\")" + " with methods", around25, withMethods);
observe("\"abc\".replace(t, \"x\")" + " with a proxy", around25, trapped);
observe("\"abc\".replace(t, \"x\")" + " with a proxy of a function", around25, trappedFunction);
observe("\"abc\".replaceAll(t, \"x\")" + " with a number", around26, () => 1);
observe("\"abc\".replaceAll(t, \"x\")" + " with methods", around26, withMethods);
observe("\"abc\".replaceAll(t, \"x\")" + " with a proxy", around26, trapped);
observe("\"abc\".replaceAll(t, \"x\")" + " with a proxy of a function", around26, trappedFunction);
observe("\"abc\".localeCompare(t)" + " with a number", around27, () => 1);
observe("\"abc\".localeCompare(t)" + " with methods", around27, withMethods);
observe("\"abc\".localeCompare(t)" + " with a proxy", around27, trapped);
observe("\"abc\".localeCompare(t)" + " with a proxy of a function", around27, trappedFunction);
observe("\"abc\".match(t)" + " with a number", around28, () => 1);
observe("\"abc\".match(t)" + " with methods", around28, withMethods);
observe("\"abc\".match(t)" + " with a proxy", around28, trapped);
observe("\"abc\".match(t)" + " with a proxy of a function", around28, trappedFunction);
observe("\"abc\".matchAll(t)" + " with a number", around29, () => 1);
observe("\"abc\".matchAll(t)" + " with methods", around29, withMethods);
observe("\"abc\".matchAll(t)" + " with a proxy", around29, trapped);
observe("\"abc\".matchAll(t)" + " with a proxy of a function", around29, trappedFunction);
observe("\"abc\".search(t)" + " with a number", around30, () => 1);
observe("\"abc\".search(t)" + " with methods", around30, withMethods);
observe("\"abc\".search(t)" + " with a proxy", around30, trapped);
observe("\"abc\".search(t)" + " with a proxy of a function", around30, trappedFunction);
observe("\"abc\" + t" + " with a number", around31, () => 1);
observe("\"abc\" + t" + " with methods", around31, withMethods);
observe("\"abc\" + t" + " with a proxy", around31, trapped);
observe("\"abc\" + t" + " with a proxy of a function", around31, trappedFunction);
