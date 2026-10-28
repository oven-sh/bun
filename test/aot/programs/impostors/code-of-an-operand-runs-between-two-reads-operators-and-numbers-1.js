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
  void (+t);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around2(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (-t);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around3(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (~t);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around4(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (t + "");
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around5(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (`${t}`);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around6(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (t * 2);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around7(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (2 / t);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around8(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (t % 2);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around9(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (t ** 2);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around10(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (t | 0);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around11(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (t >>> 0);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around12(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (t << 1);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around13(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (t < 1);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around14(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (1 >= t);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around15(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (t == 1);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around16(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("1" != t);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around17(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (({})[t]);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around18(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (({ [t]: 1 }));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around19(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (t in {});
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around20(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ("k" in t);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around21(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (t.k);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around22(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (t?.k);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around23(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (t.k = 1);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around24(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (delete t.k);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around25(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (t instanceof Object);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around26(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ([...t]);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around27(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Math.max(...t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around28(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ((([first]) => first)(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around29(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (({ ...t }));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around30(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ((({ k }) => k)(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around31(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ((() => { for (const k in t) return k; })());
  return before + " / " + [o.y, a[0], shared].join(" ");
}

console.log("strict:", (function () { return this === undefined; })());
observe("+t" + " with a number", around1, () => 1);
observe("+t" + " with methods", around1, withMethods);
observe("+t" + " with a proxy", around1, trapped);
observe("+t" + " with a proxy of a function", around1, trappedFunction);
observe("-t" + " with a number", around2, () => 1);
observe("-t" + " with methods", around2, withMethods);
observe("-t" + " with a proxy", around2, trapped);
observe("-t" + " with a proxy of a function", around2, trappedFunction);
observe("~t" + " with a number", around3, () => 1);
observe("~t" + " with methods", around3, withMethods);
observe("~t" + " with a proxy", around3, trapped);
observe("~t" + " with a proxy of a function", around3, trappedFunction);
observe("t + \"\"" + " with a number", around4, () => 1);
observe("t + \"\"" + " with methods", around4, withMethods);
observe("t + \"\"" + " with a proxy", around4, trapped);
observe("t + \"\"" + " with a proxy of a function", around4, trappedFunction);
observe("`${t}`" + " with a number", around5, () => 1);
observe("`${t}`" + " with methods", around5, withMethods);
observe("`${t}`" + " with a proxy", around5, trapped);
observe("`${t}`" + " with a proxy of a function", around5, trappedFunction);
observe("t * 2" + " with a number", around6, () => 1);
observe("t * 2" + " with methods", around6, withMethods);
observe("t * 2" + " with a proxy", around6, trapped);
observe("t * 2" + " with a proxy of a function", around6, trappedFunction);
observe("2 / t" + " with a number", around7, () => 1);
observe("2 / t" + " with methods", around7, withMethods);
observe("2 / t" + " with a proxy", around7, trapped);
observe("2 / t" + " with a proxy of a function", around7, trappedFunction);
observe("t % 2" + " with a number", around8, () => 1);
observe("t % 2" + " with methods", around8, withMethods);
observe("t % 2" + " with a proxy", around8, trapped);
observe("t % 2" + " with a proxy of a function", around8, trappedFunction);
observe("t ** 2" + " with a number", around9, () => 1);
observe("t ** 2" + " with methods", around9, withMethods);
observe("t ** 2" + " with a proxy", around9, trapped);
observe("t ** 2" + " with a proxy of a function", around9, trappedFunction);
observe("t | 0" + " with a number", around10, () => 1);
observe("t | 0" + " with methods", around10, withMethods);
observe("t | 0" + " with a proxy", around10, trapped);
observe("t | 0" + " with a proxy of a function", around10, trappedFunction);
observe("t >>> 0" + " with a number", around11, () => 1);
observe("t >>> 0" + " with methods", around11, withMethods);
observe("t >>> 0" + " with a proxy", around11, trapped);
observe("t >>> 0" + " with a proxy of a function", around11, trappedFunction);
observe("t << 1" + " with a number", around12, () => 1);
observe("t << 1" + " with methods", around12, withMethods);
observe("t << 1" + " with a proxy", around12, trapped);
observe("t << 1" + " with a proxy of a function", around12, trappedFunction);
observe("t < 1" + " with a number", around13, () => 1);
observe("t < 1" + " with methods", around13, withMethods);
observe("t < 1" + " with a proxy", around13, trapped);
observe("t < 1" + " with a proxy of a function", around13, trappedFunction);
observe("1 >= t" + " with a number", around14, () => 1);
observe("1 >= t" + " with methods", around14, withMethods);
observe("1 >= t" + " with a proxy", around14, trapped);
observe("1 >= t" + " with a proxy of a function", around14, trappedFunction);
observe("t == 1" + " with a number", around15, () => 1);
observe("t == 1" + " with methods", around15, withMethods);
observe("t == 1" + " with a proxy", around15, trapped);
observe("t == 1" + " with a proxy of a function", around15, trappedFunction);
observe("\"1\" != t" + " with a number", around16, () => 1);
observe("\"1\" != t" + " with methods", around16, withMethods);
observe("\"1\" != t" + " with a proxy", around16, trapped);
observe("\"1\" != t" + " with a proxy of a function", around16, trappedFunction);
observe("({})[t]" + " with a number", around17, () => 1);
observe("({})[t]" + " with methods", around17, withMethods);
observe("({})[t]" + " with a proxy", around17, trapped);
observe("({})[t]" + " with a proxy of a function", around17, trappedFunction);
observe("({ [t]: 1 })" + " with a number", around18, () => 1);
observe("({ [t]: 1 })" + " with methods", around18, withMethods);
observe("({ [t]: 1 })" + " with a proxy", around18, trapped);
observe("({ [t]: 1 })" + " with a proxy of a function", around18, trappedFunction);
observe("t in {}" + " with a number", around19, () => 1);
observe("t in {}" + " with methods", around19, withMethods);
observe("t in {}" + " with a proxy", around19, trapped);
observe("t in {}" + " with a proxy of a function", around19, trappedFunction);
observe("\"k\" in t" + " with a number", around20, () => 1);
observe("\"k\" in t" + " with methods", around20, withMethods);
observe("\"k\" in t" + " with a proxy", around20, trapped);
observe("\"k\" in t" + " with a proxy of a function", around20, trappedFunction);
observe("t.k" + " with a number", around21, () => 1);
observe("t.k" + " with methods", around21, withMethods);
observe("t.k" + " with a proxy", around21, trapped);
observe("t.k" + " with a proxy of a function", around21, trappedFunction);
observe("t?.k" + " with a number", around22, () => 1);
observe("t?.k" + " with methods", around22, withMethods);
observe("t?.k" + " with a proxy", around22, trapped);
observe("t?.k" + " with a proxy of a function", around22, trappedFunction);
observe("t.k = 1" + " with a number", around23, () => 1);
observe("t.k = 1" + " with methods", around23, withMethods);
observe("t.k = 1" + " with a proxy", around23, trapped);
observe("t.k = 1" + " with a proxy of a function", around23, trappedFunction);
observe("delete t.k" + " with a number", around24, () => 1);
observe("delete t.k" + " with methods", around24, withMethods);
observe("delete t.k" + " with a proxy", around24, trapped);
observe("delete t.k" + " with a proxy of a function", around24, trappedFunction);
observe("t instanceof Object" + " with a number", around25, () => 1);
observe("t instanceof Object" + " with methods", around25, withMethods);
observe("t instanceof Object" + " with a proxy", around25, trapped);
observe("t instanceof Object" + " with a proxy of a function", around25, trappedFunction);
observe("[...t]" + " with a number", around26, () => 1);
observe("[...t]" + " with methods", around26, withMethods);
observe("[...t]" + " with a proxy", around26, trapped);
observe("[...t]" + " with a proxy of a function", around26, trappedFunction);
observe("Math.max(...t)" + " with a number", around27, () => 1);
observe("Math.max(...t)" + " with methods", around27, withMethods);
observe("Math.max(...t)" + " with a proxy", around27, trapped);
observe("Math.max(...t)" + " with a proxy of a function", around27, trappedFunction);
observe("(([first]) => first)(t)" + " with a number", around28, () => 1);
observe("(([first]) => first)(t)" + " with methods", around28, withMethods);
observe("(([first]) => first)(t)" + " with a proxy", around28, trapped);
observe("(([first]) => first)(t)" + " with a proxy of a function", around28, trappedFunction);
observe("({ ...t })" + " with a number", around29, () => 1);
observe("({ ...t })" + " with methods", around29, withMethods);
observe("({ ...t })" + " with a proxy", around29, trapped);
observe("({ ...t })" + " with a proxy of a function", around29, trappedFunction);
observe("(({ k }) => k)(t)" + " with a number", around30, () => 1);
observe("(({ k }) => k)(t)" + " with methods", around30, withMethods);
observe("(({ k }) => k)(t)" + " with a proxy", around30, trapped);
observe("(({ k }) => k)(t)" + " with a proxy of a function", around30, trappedFunction);
observe("(() => { for (const k in t) return k; })()" + " with a number", around31, () => 1);
observe("(() => { for (const k in t) return k; })()" + " with methods", around31, withMethods);
observe("(() => { for (const k in t) return k; })()" + " with a proxy", around31, trapped);
observe("(() => { for (const k in t) return k; })()" + " with a proxy of a function", around31, trappedFunction);
