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
  void ([1, 2].slice(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around2(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ([1, 2].slice(0, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around3(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ([1, 2].at(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around4(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ([1, 2].indexOf(1, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around5(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ([1, 2].lastIndexOf(1, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around6(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ([1, 2].includes(1, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around7(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ([1, 2].fill(0, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around8(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ([1, 2].fill(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around9(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ([1, 2].join(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around10(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ([1, 2].concat(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around11(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ([1, 2].splice(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around12(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ([1, 2].splice(0, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around13(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ([1, 2].toSpliced(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around14(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ([1, 2].copyWithin(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around15(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ([1, 2].flat(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around16(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ([1, 2].with(t, 0));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around17(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ([t].join());
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around18(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ([t].toString());
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around19(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ([t].toLocaleString());
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around20(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ([t, t].sort());
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around21(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ([t, t].toSorted());
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around22(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ([t].includes(1));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around23(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ([t].indexOf(1));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around24(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ([[t]].flat());
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around25(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ([t] + "");
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around26(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ([1, 2][t]);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around27(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ([1, 2][t] = 0);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around28(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ([1, 2].length = t);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around29(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Array(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around30(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Array.of(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around31(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Array.isArray(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around32(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Array.from(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around33(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Array.from({ length: t }));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around34(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Array.prototype.slice.call(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around35(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Array.prototype.map.call(t, x => x));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around36(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Array.prototype.push.call(t, 1));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around37(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Array.prototype.pop.call(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around38(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Array.prototype.join.call(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

console.log("strict:", (function () { return this === undefined; })());
observe("[1, 2].slice(t)" + " with a number", around1, () => 1);
observe("[1, 2].slice(t)" + " with methods", around1, withMethods);
observe("[1, 2].slice(t)" + " with a proxy", around1, trapped);
observe("[1, 2].slice(t)" + " with a proxy of a function", around1, trappedFunction);
observe("[1, 2].slice(0, t)" + " with a number", around2, () => 1);
observe("[1, 2].slice(0, t)" + " with methods", around2, withMethods);
observe("[1, 2].slice(0, t)" + " with a proxy", around2, trapped);
observe("[1, 2].slice(0, t)" + " with a proxy of a function", around2, trappedFunction);
observe("[1, 2].at(t)" + " with a number", around3, () => 1);
observe("[1, 2].at(t)" + " with methods", around3, withMethods);
observe("[1, 2].at(t)" + " with a proxy", around3, trapped);
observe("[1, 2].at(t)" + " with a proxy of a function", around3, trappedFunction);
observe("[1, 2].indexOf(1, t)" + " with a number", around4, () => 1);
observe("[1, 2].indexOf(1, t)" + " with methods", around4, withMethods);
observe("[1, 2].indexOf(1, t)" + " with a proxy", around4, trapped);
observe("[1, 2].indexOf(1, t)" + " with a proxy of a function", around4, trappedFunction);
observe("[1, 2].lastIndexOf(1, t)" + " with a number", around5, () => 1);
observe("[1, 2].lastIndexOf(1, t)" + " with methods", around5, withMethods);
observe("[1, 2].lastIndexOf(1, t)" + " with a proxy", around5, trapped);
observe("[1, 2].lastIndexOf(1, t)" + " with a proxy of a function", around5, trappedFunction);
observe("[1, 2].includes(1, t)" + " with a number", around6, () => 1);
observe("[1, 2].includes(1, t)" + " with methods", around6, withMethods);
observe("[1, 2].includes(1, t)" + " with a proxy", around6, trapped);
observe("[1, 2].includes(1, t)" + " with a proxy of a function", around6, trappedFunction);
observe("[1, 2].fill(0, t)" + " with a number", around7, () => 1);
observe("[1, 2].fill(0, t)" + " with methods", around7, withMethods);
observe("[1, 2].fill(0, t)" + " with a proxy", around7, trapped);
observe("[1, 2].fill(0, t)" + " with a proxy of a function", around7, trappedFunction);
observe("[1, 2].fill(t)" + " with a number", around8, () => 1);
observe("[1, 2].fill(t)" + " with methods", around8, withMethods);
observe("[1, 2].fill(t)" + " with a proxy", around8, trapped);
observe("[1, 2].fill(t)" + " with a proxy of a function", around8, trappedFunction);
observe("[1, 2].join(t)" + " with a number", around9, () => 1);
observe("[1, 2].join(t)" + " with methods", around9, withMethods);
observe("[1, 2].join(t)" + " with a proxy", around9, trapped);
observe("[1, 2].join(t)" + " with a proxy of a function", around9, trappedFunction);
observe("[1, 2].concat(t)" + " with a number", around10, () => 1);
observe("[1, 2].concat(t)" + " with methods", around10, withMethods);
observe("[1, 2].concat(t)" + " with a proxy", around10, trapped);
observe("[1, 2].concat(t)" + " with a proxy of a function", around10, trappedFunction);
observe("[1, 2].splice(t)" + " with a number", around11, () => 1);
observe("[1, 2].splice(t)" + " with methods", around11, withMethods);
observe("[1, 2].splice(t)" + " with a proxy", around11, trapped);
observe("[1, 2].splice(t)" + " with a proxy of a function", around11, trappedFunction);
observe("[1, 2].splice(0, t)" + " with a number", around12, () => 1);
observe("[1, 2].splice(0, t)" + " with methods", around12, withMethods);
observe("[1, 2].splice(0, t)" + " with a proxy", around12, trapped);
observe("[1, 2].splice(0, t)" + " with a proxy of a function", around12, trappedFunction);
observe("[1, 2].toSpliced(t)" + " with a number", around13, () => 1);
observe("[1, 2].toSpliced(t)" + " with methods", around13, withMethods);
observe("[1, 2].toSpliced(t)" + " with a proxy", around13, trapped);
observe("[1, 2].toSpliced(t)" + " with a proxy of a function", around13, trappedFunction);
observe("[1, 2].copyWithin(t)" + " with a number", around14, () => 1);
observe("[1, 2].copyWithin(t)" + " with methods", around14, withMethods);
observe("[1, 2].copyWithin(t)" + " with a proxy", around14, trapped);
observe("[1, 2].copyWithin(t)" + " with a proxy of a function", around14, trappedFunction);
observe("[1, 2].flat(t)" + " with a number", around15, () => 1);
observe("[1, 2].flat(t)" + " with methods", around15, withMethods);
observe("[1, 2].flat(t)" + " with a proxy", around15, trapped);
observe("[1, 2].flat(t)" + " with a proxy of a function", around15, trappedFunction);
observe("[1, 2].with(t, 0)" + " with a number", around16, () => 1);
observe("[1, 2].with(t, 0)" + " with methods", around16, withMethods);
observe("[1, 2].with(t, 0)" + " with a proxy", around16, trapped);
observe("[1, 2].with(t, 0)" + " with a proxy of a function", around16, trappedFunction);
observe("[t].join()" + " with a number", around17, () => 1);
observe("[t].join()" + " with methods", around17, withMethods);
observe("[t].join()" + " with a proxy", around17, trapped);
observe("[t].join()" + " with a proxy of a function", around17, trappedFunction);
observe("[t].toString()" + " with a number", around18, () => 1);
observe("[t].toString()" + " with methods", around18, withMethods);
observe("[t].toString()" + " with a proxy", around18, trapped);
observe("[t].toString()" + " with a proxy of a function", around18, trappedFunction);
observe("[t].toLocaleString()" + " with a number", around19, () => 1);
observe("[t].toLocaleString()" + " with methods", around19, withMethods);
observe("[t].toLocaleString()" + " with a proxy", around19, trapped);
observe("[t].toLocaleString()" + " with a proxy of a function", around19, trappedFunction);
observe("[t, t].sort()" + " with a number", around20, () => 1);
observe("[t, t].sort()" + " with methods", around20, withMethods);
observe("[t, t].sort()" + " with a proxy", around20, trapped);
observe("[t, t].sort()" + " with a proxy of a function", around20, trappedFunction);
observe("[t, t].toSorted()" + " with a number", around21, () => 1);
observe("[t, t].toSorted()" + " with methods", around21, withMethods);
observe("[t, t].toSorted()" + " with a proxy", around21, trapped);
observe("[t, t].toSorted()" + " with a proxy of a function", around21, trappedFunction);
observe("[t].includes(1)" + " with a number", around22, () => 1);
observe("[t].includes(1)" + " with methods", around22, withMethods);
observe("[t].includes(1)" + " with a proxy", around22, trapped);
observe("[t].includes(1)" + " with a proxy of a function", around22, trappedFunction);
observe("[t].indexOf(1)" + " with a number", around23, () => 1);
observe("[t].indexOf(1)" + " with methods", around23, withMethods);
observe("[t].indexOf(1)" + " with a proxy", around23, trapped);
observe("[t].indexOf(1)" + " with a proxy of a function", around23, trappedFunction);
observe("[[t]].flat()" + " with a number", around24, () => 1);
observe("[[t]].flat()" + " with methods", around24, withMethods);
observe("[[t]].flat()" + " with a proxy", around24, trapped);
observe("[[t]].flat()" + " with a proxy of a function", around24, trappedFunction);
observe("[t] + \"\"" + " with a number", around25, () => 1);
observe("[t] + \"\"" + " with methods", around25, withMethods);
observe("[t] + \"\"" + " with a proxy", around25, trapped);
observe("[t] + \"\"" + " with a proxy of a function", around25, trappedFunction);
observe("[1, 2][t]" + " with a number", around26, () => 1);
observe("[1, 2][t]" + " with methods", around26, withMethods);
observe("[1, 2][t]" + " with a proxy", around26, trapped);
observe("[1, 2][t]" + " with a proxy of a function", around26, trappedFunction);
observe("[1, 2][t] = 0" + " with a number", around27, () => 1);
observe("[1, 2][t] = 0" + " with methods", around27, withMethods);
observe("[1, 2][t] = 0" + " with a proxy", around27, trapped);
observe("[1, 2][t] = 0" + " with a proxy of a function", around27, trappedFunction);
observe("[1, 2].length = t" + " with a number", around28, () => 1);
observe("[1, 2].length = t" + " with methods", around28, withMethods);
observe("[1, 2].length = t" + " with a proxy", around28, trapped);
observe("[1, 2].length = t" + " with a proxy of a function", around28, trappedFunction);
observe("new Array(t)" + " with a number", around29, () => 1);
observe("new Array(t)" + " with methods", around29, withMethods);
observe("new Array(t)" + " with a proxy", around29, trapped);
observe("new Array(t)" + " with a proxy of a function", around29, trappedFunction);
observe("Array.of(t)" + " with a number", around30, () => 1);
observe("Array.of(t)" + " with methods", around30, withMethods);
observe("Array.of(t)" + " with a proxy", around30, trapped);
observe("Array.of(t)" + " with a proxy of a function", around30, trappedFunction);
observe("Array.isArray(t)" + " with a number", around31, () => 1);
observe("Array.isArray(t)" + " with methods", around31, withMethods);
observe("Array.isArray(t)" + " with a proxy", around31, trapped);
observe("Array.isArray(t)" + " with a proxy of a function", around31, trappedFunction);
observe("Array.from(t)" + " with a number", around32, () => 1);
observe("Array.from(t)" + " with methods", around32, withMethods);
observe("Array.from(t)" + " with a proxy", around32, trapped);
observe("Array.from(t)" + " with a proxy of a function", around32, trappedFunction);
observe("Array.from({ length: t })" + " with a number", around33, () => 1);
observe("Array.from({ length: t })" + " with methods", around33, withMethods);
observe("Array.from({ length: t })" + " with a proxy", around33, trapped);
observe("Array.from({ length: t })" + " with a proxy of a function", around33, trappedFunction);
observe("Array.prototype.slice.call(t)" + " with a number", around34, () => 1);
observe("Array.prototype.slice.call(t)" + " with methods", around34, withMethods);
observe("Array.prototype.slice.call(t)" + " with a proxy", around34, trapped);
observe("Array.prototype.slice.call(t)" + " with a proxy of a function", around34, trappedFunction);
observe("Array.prototype.map.call(t, x => x)" + " with a number", around35, () => 1);
observe("Array.prototype.map.call(t, x => x)" + " with methods", around35, withMethods);
observe("Array.prototype.map.call(t, x => x)" + " with a proxy", around35, trapped);
observe("Array.prototype.map.call(t, x => x)" + " with a proxy of a function", around35, trappedFunction);
observe("Array.prototype.push.call(t, 1)" + " with a number", around36, () => 1);
observe("Array.prototype.push.call(t, 1)" + " with methods", around36, withMethods);
observe("Array.prototype.push.call(t, 1)" + " with a proxy", around36, trapped);
observe("Array.prototype.push.call(t, 1)" + " with a proxy of a function", around36, trappedFunction);
observe("Array.prototype.pop.call(t)" + " with a number", around37, () => 1);
observe("Array.prototype.pop.call(t)" + " with methods", around37, withMethods);
observe("Array.prototype.pop.call(t)" + " with a proxy", around37, trapped);
observe("Array.prototype.pop.call(t)" + " with a proxy of a function", around37, trappedFunction);
observe("Array.prototype.join.call(t)" + " with a number", around38, () => 1);
observe("Array.prototype.join.call(t)" + " with methods", around38, withMethods);
observe("Array.prototype.join.call(t)" + " with a proxy", around38, trapped);
observe("Array.prototype.join.call(t)" + " with a proxy of a function", around38, trappedFunction);
