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
  void ("abc" < t);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around2(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (String.fromCharCode(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around3(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (String.fromCodePoint(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around4(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (String.raw({ raw: t }));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around5(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (String.raw({ raw: ["a", "b"] }, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around6(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (String.prototype.trim.call(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around7(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (String.prototype.toUpperCase.call(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around8(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (String.prototype.at.call(t, 0));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around9(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new RegExp(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around10(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new RegExp("a", t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around11(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (/1/.test(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around12(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (/1/.exec(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around13(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (/1/[Symbol.replace](t, "x"));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around14(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (/1/[Symbol.split](t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around15(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (encodeURIComponent(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around16(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (decodeURI(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around17(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (escape(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around18(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (btoa(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around19(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (atob(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around20(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Error(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around21(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Error("m", t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around22(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new AggregateError(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around23(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new AggregateError([], t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around24(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new TextEncoder().encode(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around25(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new URLSearchParams(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around26(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new URL(t, "http://localhost"));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around27(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Headers(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around28(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Headers().get(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around29(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Blob([t]));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around30(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Event(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around31(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new CustomEvent("e", t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

console.log("strict:", (function () { return this === undefined; })());
observe("\"abc\" < t" + " with a number", around1, () => 1);
observe("\"abc\" < t" + " with methods", around1, withMethods);
observe("\"abc\" < t" + " with a proxy", around1, trapped);
observe("\"abc\" < t" + " with a proxy of a function", around1, trappedFunction);
observe("String.fromCharCode(t)" + " with a number", around2, () => 1);
observe("String.fromCharCode(t)" + " with methods", around2, withMethods);
observe("String.fromCharCode(t)" + " with a proxy", around2, trapped);
observe("String.fromCharCode(t)" + " with a proxy of a function", around2, trappedFunction);
observe("String.fromCodePoint(t)" + " with a number", around3, () => 1);
observe("String.fromCodePoint(t)" + " with methods", around3, withMethods);
observe("String.fromCodePoint(t)" + " with a proxy", around3, trapped);
observe("String.fromCodePoint(t)" + " with a proxy of a function", around3, trappedFunction);
observe("String.raw({ raw: t })" + " with a number", around4, () => 1);
observe("String.raw({ raw: t })" + " with methods", around4, withMethods);
observe("String.raw({ raw: t })" + " with a proxy", around4, trapped);
observe("String.raw({ raw: t })" + " with a proxy of a function", around4, trappedFunction);
observe("String.raw({ raw: [\"a\", \"b\"] }, t)" + " with a number", around5, () => 1);
observe("String.raw({ raw: [\"a\", \"b\"] }, t)" + " with methods", around5, withMethods);
observe("String.raw({ raw: [\"a\", \"b\"] }, t)" + " with a proxy", around5, trapped);
observe("String.raw({ raw: [\"a\", \"b\"] }, t)" + " with a proxy of a function", around5, trappedFunction);
observe("String.prototype.trim.call(t)" + " with a number", around6, () => 1);
observe("String.prototype.trim.call(t)" + " with methods", around6, withMethods);
observe("String.prototype.trim.call(t)" + " with a proxy", around6, trapped);
observe("String.prototype.trim.call(t)" + " with a proxy of a function", around6, trappedFunction);
observe("String.prototype.toUpperCase.call(t)" + " with a number", around7, () => 1);
observe("String.prototype.toUpperCase.call(t)" + " with methods", around7, withMethods);
observe("String.prototype.toUpperCase.call(t)" + " with a proxy", around7, trapped);
observe("String.prototype.toUpperCase.call(t)" + " with a proxy of a function", around7, trappedFunction);
observe("String.prototype.at.call(t, 0)" + " with a number", around8, () => 1);
observe("String.prototype.at.call(t, 0)" + " with methods", around8, withMethods);
observe("String.prototype.at.call(t, 0)" + " with a proxy", around8, trapped);
observe("String.prototype.at.call(t, 0)" + " with a proxy of a function", around8, trappedFunction);
observe("new RegExp(t)" + " with a number", around9, () => 1);
observe("new RegExp(t)" + " with methods", around9, withMethods);
observe("new RegExp(t)" + " with a proxy", around9, trapped);
observe("new RegExp(t)" + " with a proxy of a function", around9, trappedFunction);
observe("new RegExp(\"a\", t)" + " with a number", around10, () => 1);
observe("new RegExp(\"a\", t)" + " with methods", around10, withMethods);
observe("new RegExp(\"a\", t)" + " with a proxy", around10, trapped);
observe("new RegExp(\"a\", t)" + " with a proxy of a function", around10, trappedFunction);
observe("/1/.test(t)" + " with a number", around11, () => 1);
observe("/1/.test(t)" + " with methods", around11, withMethods);
observe("/1/.test(t)" + " with a proxy", around11, trapped);
observe("/1/.test(t)" + " with a proxy of a function", around11, trappedFunction);
observe("/1/.exec(t)" + " with a number", around12, () => 1);
observe("/1/.exec(t)" + " with methods", around12, withMethods);
observe("/1/.exec(t)" + " with a proxy", around12, trapped);
observe("/1/.exec(t)" + " with a proxy of a function", around12, trappedFunction);
observe("/1/[Symbol.replace](t, \"x\")" + " with a number", around13, () => 1);
observe("/1/[Symbol.replace](t, \"x\")" + " with methods", around13, withMethods);
observe("/1/[Symbol.replace](t, \"x\")" + " with a proxy", around13, trapped);
observe("/1/[Symbol.replace](t, \"x\")" + " with a proxy of a function", around13, trappedFunction);
observe("/1/[Symbol.split](t)" + " with a number", around14, () => 1);
observe("/1/[Symbol.split](t)" + " with methods", around14, withMethods);
observe("/1/[Symbol.split](t)" + " with a proxy", around14, trapped);
observe("/1/[Symbol.split](t)" + " with a proxy of a function", around14, trappedFunction);
observe("encodeURIComponent(t)" + " with a number", around15, () => 1);
observe("encodeURIComponent(t)" + " with methods", around15, withMethods);
observe("encodeURIComponent(t)" + " with a proxy", around15, trapped);
observe("encodeURIComponent(t)" + " with a proxy of a function", around15, trappedFunction);
observe("decodeURI(t)" + " with a number", around16, () => 1);
observe("decodeURI(t)" + " with methods", around16, withMethods);
observe("decodeURI(t)" + " with a proxy", around16, trapped);
observe("decodeURI(t)" + " with a proxy of a function", around16, trappedFunction);
observe("escape(t)" + " with a number", around17, () => 1);
observe("escape(t)" + " with methods", around17, withMethods);
observe("escape(t)" + " with a proxy", around17, trapped);
observe("escape(t)" + " with a proxy of a function", around17, trappedFunction);
observe("btoa(t)" + " with a number", around18, () => 1);
observe("btoa(t)" + " with methods", around18, withMethods);
observe("btoa(t)" + " with a proxy", around18, trapped);
observe("btoa(t)" + " with a proxy of a function", around18, trappedFunction);
observe("atob(t)" + " with a number", around19, () => 1);
observe("atob(t)" + " with methods", around19, withMethods);
observe("atob(t)" + " with a proxy", around19, trapped);
observe("atob(t)" + " with a proxy of a function", around19, trappedFunction);
observe("new Error(t)" + " with a number", around20, () => 1);
observe("new Error(t)" + " with methods", around20, withMethods);
observe("new Error(t)" + " with a proxy", around20, trapped);
observe("new Error(t)" + " with a proxy of a function", around20, trappedFunction);
observe("new Error(\"m\", t)" + " with a number", around21, () => 1);
observe("new Error(\"m\", t)" + " with methods", around21, withMethods);
observe("new Error(\"m\", t)" + " with a proxy", around21, trapped);
observe("new Error(\"m\", t)" + " with a proxy of a function", around21, trappedFunction);
observe("new AggregateError(t)" + " with a number", around22, () => 1);
observe("new AggregateError(t)" + " with methods", around22, withMethods);
observe("new AggregateError(t)" + " with a proxy", around22, trapped);
observe("new AggregateError(t)" + " with a proxy of a function", around22, trappedFunction);
observe("new AggregateError([], t)" + " with a number", around23, () => 1);
observe("new AggregateError([], t)" + " with methods", around23, withMethods);
observe("new AggregateError([], t)" + " with a proxy", around23, trapped);
observe("new AggregateError([], t)" + " with a proxy of a function", around23, trappedFunction);
observe("new TextEncoder().encode(t)" + " with a number", around24, () => 1);
observe("new TextEncoder().encode(t)" + " with methods", around24, withMethods);
observe("new TextEncoder().encode(t)" + " with a proxy", around24, trapped);
observe("new TextEncoder().encode(t)" + " with a proxy of a function", around24, trappedFunction);
observe("new URLSearchParams(t)" + " with a number", around25, () => 1);
observe("new URLSearchParams(t)" + " with methods", around25, withMethods);
observe("new URLSearchParams(t)" + " with a proxy", around25, trapped);
observe("new URLSearchParams(t)" + " with a proxy of a function", around25, trappedFunction);
observe("new URL(t, \"http://localhost\")" + " with a number", around26, () => 1);
observe("new URL(t, \"http://localhost\")" + " with methods", around26, withMethods);
observe("new URL(t, \"http://localhost\")" + " with a proxy", around26, trapped);
observe("new URL(t, \"http://localhost\")" + " with a proxy of a function", around26, trappedFunction);
observe("new Headers(t)" + " with a number", around27, () => 1);
observe("new Headers(t)" + " with methods", around27, withMethods);
observe("new Headers(t)" + " with a proxy", around27, trapped);
observe("new Headers(t)" + " with a proxy of a function", around27, trappedFunction);
observe("new Headers().get(t)" + " with a number", around28, () => 1);
observe("new Headers().get(t)" + " with methods", around28, withMethods);
observe("new Headers().get(t)" + " with a proxy", around28, trapped);
observe("new Headers().get(t)" + " with a proxy of a function", around28, trappedFunction);
observe("new Blob([t])" + " with a number", around29, () => 1);
observe("new Blob([t])" + " with methods", around29, withMethods);
observe("new Blob([t])" + " with a proxy", around29, trapped);
observe("new Blob([t])" + " with a proxy of a function", around29, trappedFunction);
observe("new Event(t)" + " with a number", around30, () => 1);
observe("new Event(t)" + " with methods", around30, withMethods);
observe("new Event(t)" + " with a proxy", around30, trapped);
observe("new Event(t)" + " with a proxy of a function", around30, trappedFunction);
observe("new CustomEvent(\"e\", t)" + " with a number", around31, () => 1);
observe("new CustomEvent(\"e\", t)" + " with methods", around31, withMethods);
observe("new CustomEvent(\"e\", t)" + " with a proxy", around31, trapped);
observe("new CustomEvent(\"e\", t)" + " with a proxy of a function", around31, trappedFunction);
