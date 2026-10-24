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
  void (new Set([1]).union(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around2(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Set([1]).isSubsetOf(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around3(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new WeakMap(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around4(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new WeakSet(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around5(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new WeakRef(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around6(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Map.groupBy(t, x => x));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around7(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Date(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around8(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Date(2000, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around9(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Date.UTC(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around10(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Date.parse(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around11(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Date(0).setFullYear(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around12(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Date(0).setTime(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around13(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Date(0).toJSON.call(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around14(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Date(0)[Symbol.toPrimitive].call(t, "number"));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around15(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Promise.resolve(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around16(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Promise.reject(t).catch(() => {}));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around17(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Promise.all(t).catch(() => {}));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around18(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Promise.all([t]).catch(() => {}));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around19(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Promise.race(t).catch(() => {}));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around20(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Promise.allSettled(t).catch(() => {}));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around21(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Promise.any(t).catch(() => {}));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around22(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Promise(resolve => resolve(t)));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around23(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Promise.prototype.then.call(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around24(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Iterator.from(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around25(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Iterator.from(t).next());
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around26(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Iterator.prototype.toArray.call(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around27(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (structuredClone(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around28(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (structuredClone(1, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around29(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (clearTimeout(setTimeout(() => {}, t)));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around30(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (clearTimeout(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around31(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new AbortController().abort(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around32(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (AbortSignal.any(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around33(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Proxy(t, {}));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around34(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Proxy({}, t).k);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around35(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Bun.inspect(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around36(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Bun.deepEquals(t, {}));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around37(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Bun.deepEquals({ k: 1 }, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around38(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Bun.escapeHTML(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around39(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Bun.stringWidth(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around40(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void ((process.env.IMPOSTOR_OPERAND = t, delete process.env.IMPOSTOR_OPERAND));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

console.log("strict:", (function () { return this === undefined; })());
observe("new Set([1]).union(t)" + " with a number", around1, () => 1);
observe("new Set([1]).union(t)" + " with methods", around1, withMethods);
observe("new Set([1]).union(t)" + " with a proxy", around1, trapped);
observe("new Set([1]).union(t)" + " with a proxy of a function", around1, trappedFunction);
observe("new Set([1]).isSubsetOf(t)" + " with a number", around2, () => 1);
observe("new Set([1]).isSubsetOf(t)" + " with methods", around2, withMethods);
observe("new Set([1]).isSubsetOf(t)" + " with a proxy", around2, trapped);
observe("new Set([1]).isSubsetOf(t)" + " with a proxy of a function", around2, trappedFunction);
observe("new WeakMap(t)" + " with a number", around3, () => 1);
observe("new WeakMap(t)" + " with methods", around3, withMethods);
observe("new WeakMap(t)" + " with a proxy", around3, trapped);
observe("new WeakMap(t)" + " with a proxy of a function", around3, trappedFunction);
observe("new WeakSet(t)" + " with a number", around4, () => 1);
observe("new WeakSet(t)" + " with methods", around4, withMethods);
observe("new WeakSet(t)" + " with a proxy", around4, trapped);
observe("new WeakSet(t)" + " with a proxy of a function", around4, trappedFunction);
observe("new WeakRef(t)" + " with a number", around5, () => 1);
observe("new WeakRef(t)" + " with methods", around5, withMethods);
observe("new WeakRef(t)" + " with a proxy", around5, trapped);
observe("new WeakRef(t)" + " with a proxy of a function", around5, trappedFunction);
observe("Map.groupBy(t, x => x)" + " with a number", around6, () => 1);
observe("Map.groupBy(t, x => x)" + " with methods", around6, withMethods);
observe("Map.groupBy(t, x => x)" + " with a proxy", around6, trapped);
observe("Map.groupBy(t, x => x)" + " with a proxy of a function", around6, trappedFunction);
observe("new Date(t)" + " with a number", around7, () => 1);
observe("new Date(t)" + " with methods", around7, withMethods);
observe("new Date(t)" + " with a proxy", around7, trapped);
observe("new Date(t)" + " with a proxy of a function", around7, trappedFunction);
observe("new Date(2000, t)" + " with a number", around8, () => 1);
observe("new Date(2000, t)" + " with methods", around8, withMethods);
observe("new Date(2000, t)" + " with a proxy", around8, trapped);
observe("new Date(2000, t)" + " with a proxy of a function", around8, trappedFunction);
observe("Date.UTC(t)" + " with a number", around9, () => 1);
observe("Date.UTC(t)" + " with methods", around9, withMethods);
observe("Date.UTC(t)" + " with a proxy", around9, trapped);
observe("Date.UTC(t)" + " with a proxy of a function", around9, trappedFunction);
observe("Date.parse(t)" + " with a number", around10, () => 1);
observe("Date.parse(t)" + " with methods", around10, withMethods);
observe("Date.parse(t)" + " with a proxy", around10, trapped);
observe("Date.parse(t)" + " with a proxy of a function", around10, trappedFunction);
observe("new Date(0).setFullYear(t)" + " with a number", around11, () => 1);
observe("new Date(0).setFullYear(t)" + " with methods", around11, withMethods);
observe("new Date(0).setFullYear(t)" + " with a proxy", around11, trapped);
observe("new Date(0).setFullYear(t)" + " with a proxy of a function", around11, trappedFunction);
observe("new Date(0).setTime(t)" + " with a number", around12, () => 1);
observe("new Date(0).setTime(t)" + " with methods", around12, withMethods);
observe("new Date(0).setTime(t)" + " with a proxy", around12, trapped);
observe("new Date(0).setTime(t)" + " with a proxy of a function", around12, trappedFunction);
observe("new Date(0).toJSON.call(t)" + " with a number", around13, () => 1);
observe("new Date(0).toJSON.call(t)" + " with methods", around13, withMethods);
observe("new Date(0).toJSON.call(t)" + " with a proxy", around13, trapped);
observe("new Date(0).toJSON.call(t)" + " with a proxy of a function", around13, trappedFunction);
observe("new Date(0)[Symbol.toPrimitive].call(t, \"number\")" + " with a number", around14, () => 1);
observe("new Date(0)[Symbol.toPrimitive].call(t, \"number\")" + " with methods", around14, withMethods);
observe("new Date(0)[Symbol.toPrimitive].call(t, \"number\")" + " with a proxy", around14, trapped);
observe("new Date(0)[Symbol.toPrimitive].call(t, \"number\")" + " with a proxy of a function", around14, trappedFunction);
observe("Promise.resolve(t)" + " with a number", around15, () => 1);
observe("Promise.resolve(t)" + " with methods", around15, withMethods);
observe("Promise.resolve(t)" + " with a proxy", around15, trapped);
observe("Promise.resolve(t)" + " with a proxy of a function", around15, trappedFunction);
observe("Promise.reject(t).catch(() => {})" + " with a number", around16, () => 1);
observe("Promise.reject(t).catch(() => {})" + " with methods", around16, withMethods);
observe("Promise.reject(t).catch(() => {})" + " with a proxy", around16, trapped);
observe("Promise.reject(t).catch(() => {})" + " with a proxy of a function", around16, trappedFunction);
observe("Promise.all(t).catch(() => {})" + " with a number", around17, () => 1);
observe("Promise.all(t).catch(() => {})" + " with methods", around17, withMethods);
observe("Promise.all(t).catch(() => {})" + " with a proxy", around17, trapped);
observe("Promise.all(t).catch(() => {})" + " with a proxy of a function", around17, trappedFunction);
observe("Promise.all([t]).catch(() => {})" + " with a number", around18, () => 1);
observe("Promise.all([t]).catch(() => {})" + " with methods", around18, withMethods);
observe("Promise.all([t]).catch(() => {})" + " with a proxy", around18, trapped);
observe("Promise.all([t]).catch(() => {})" + " with a proxy of a function", around18, trappedFunction);
observe("Promise.race(t).catch(() => {})" + " with a number", around19, () => 1);
observe("Promise.race(t).catch(() => {})" + " with methods", around19, withMethods);
observe("Promise.race(t).catch(() => {})" + " with a proxy", around19, trapped);
observe("Promise.race(t).catch(() => {})" + " with a proxy of a function", around19, trappedFunction);
observe("Promise.allSettled(t).catch(() => {})" + " with a number", around20, () => 1);
observe("Promise.allSettled(t).catch(() => {})" + " with methods", around20, withMethods);
observe("Promise.allSettled(t).catch(() => {})" + " with a proxy", around20, trapped);
observe("Promise.allSettled(t).catch(() => {})" + " with a proxy of a function", around20, trappedFunction);
observe("Promise.any(t).catch(() => {})" + " with a number", around21, () => 1);
observe("Promise.any(t).catch(() => {})" + " with methods", around21, withMethods);
observe("Promise.any(t).catch(() => {})" + " with a proxy", around21, trapped);
observe("Promise.any(t).catch(() => {})" + " with a proxy of a function", around21, trappedFunction);
observe("new Promise(resolve => resolve(t))" + " with a number", around22, () => 1);
observe("new Promise(resolve => resolve(t))" + " with methods", around22, withMethods);
observe("new Promise(resolve => resolve(t))" + " with a proxy", around22, trapped);
observe("new Promise(resolve => resolve(t))" + " with a proxy of a function", around22, trappedFunction);
observe("Promise.prototype.then.call(t)" + " with a number", around23, () => 1);
observe("Promise.prototype.then.call(t)" + " with methods", around23, withMethods);
observe("Promise.prototype.then.call(t)" + " with a proxy", around23, trapped);
observe("Promise.prototype.then.call(t)" + " with a proxy of a function", around23, trappedFunction);
observe("Iterator.from(t)" + " with a number", around24, () => 1);
observe("Iterator.from(t)" + " with methods", around24, withMethods);
observe("Iterator.from(t)" + " with a proxy", around24, trapped);
observe("Iterator.from(t)" + " with a proxy of a function", around24, trappedFunction);
observe("Iterator.from(t).next()" + " with a number", around25, () => 1);
observe("Iterator.from(t).next()" + " with methods", around25, withMethods);
observe("Iterator.from(t).next()" + " with a proxy", around25, trapped);
observe("Iterator.from(t).next()" + " with a proxy of a function", around25, trappedFunction);
observe("Iterator.prototype.toArray.call(t)" + " with a number", around26, () => 1);
observe("Iterator.prototype.toArray.call(t)" + " with methods", around26, withMethods);
observe("Iterator.prototype.toArray.call(t)" + " with a proxy", around26, trapped);
observe("Iterator.prototype.toArray.call(t)" + " with a proxy of a function", around26, trappedFunction);
observe("structuredClone(t)" + " with a number", around27, () => 1);
observe("structuredClone(t)" + " with methods", around27, withMethods);
observe("structuredClone(t)" + " with a proxy", around27, trapped);
observe("structuredClone(t)" + " with a proxy of a function", around27, trappedFunction);
observe("structuredClone(1, t)" + " with a number", around28, () => 1);
observe("structuredClone(1, t)" + " with methods", around28, withMethods);
observe("structuredClone(1, t)" + " with a proxy", around28, trapped);
observe("structuredClone(1, t)" + " with a proxy of a function", around28, trappedFunction);
observe("clearTimeout(setTimeout(() => {}, t))" + " with a number", around29, () => 1);
observe("clearTimeout(setTimeout(() => {}, t))" + " with methods", around29, withMethods);
observe("clearTimeout(setTimeout(() => {}, t))" + " with a proxy", around29, trapped);
observe("clearTimeout(setTimeout(() => {}, t))" + " with a proxy of a function", around29, trappedFunction);
observe("clearTimeout(t)" + " with a number", around30, () => 1);
observe("clearTimeout(t)" + " with methods", around30, withMethods);
observe("clearTimeout(t)" + " with a proxy", around30, trapped);
observe("clearTimeout(t)" + " with a proxy of a function", around30, trappedFunction);
observe("new AbortController().abort(t)" + " with a number", around31, () => 1);
observe("new AbortController().abort(t)" + " with methods", around31, withMethods);
observe("new AbortController().abort(t)" + " with a proxy", around31, trapped);
observe("new AbortController().abort(t)" + " with a proxy of a function", around31, trappedFunction);
observe("AbortSignal.any(t)" + " with a number", around32, () => 1);
observe("AbortSignal.any(t)" + " with methods", around32, withMethods);
observe("AbortSignal.any(t)" + " with a proxy", around32, trapped);
observe("AbortSignal.any(t)" + " with a proxy of a function", around32, trappedFunction);
observe("new Proxy(t, {})" + " with a number", around33, () => 1);
observe("new Proxy(t, {})" + " with methods", around33, withMethods);
observe("new Proxy(t, {})" + " with a proxy", around33, trapped);
observe("new Proxy(t, {})" + " with a proxy of a function", around33, trappedFunction);
observe("new Proxy({}, t).k" + " with a number", around34, () => 1);
observe("new Proxy({}, t).k" + " with methods", around34, withMethods);
observe("new Proxy({}, t).k" + " with a proxy", around34, trapped);
observe("new Proxy({}, t).k" + " with a proxy of a function", around34, trappedFunction);
observe("Bun.inspect(t)" + " with a number", around35, () => 1);
observe("Bun.inspect(t)" + " with methods", around35, withMethods);
observe("Bun.inspect(t)" + " with a proxy", around35, trapped);
observe("Bun.inspect(t)" + " with a proxy of a function", around35, trappedFunction);
observe("Bun.deepEquals(t, {})" + " with a number", around36, () => 1);
observe("Bun.deepEquals(t, {})" + " with methods", around36, withMethods);
observe("Bun.deepEquals(t, {})" + " with a proxy", around36, trapped);
observe("Bun.deepEquals(t, {})" + " with a proxy of a function", around36, trappedFunction);
observe("Bun.deepEquals({ k: 1 }, t)" + " with a number", around37, () => 1);
observe("Bun.deepEquals({ k: 1 }, t)" + " with methods", around37, withMethods);
observe("Bun.deepEquals({ k: 1 }, t)" + " with a proxy", around37, trapped);
observe("Bun.deepEquals({ k: 1 }, t)" + " with a proxy of a function", around37, trappedFunction);
observe("Bun.escapeHTML(t)" + " with a number", around38, () => 1);
observe("Bun.escapeHTML(t)" + " with methods", around38, withMethods);
observe("Bun.escapeHTML(t)" + " with a proxy", around38, trapped);
observe("Bun.escapeHTML(t)" + " with a proxy of a function", around38, trappedFunction);
observe("Bun.stringWidth(t)" + " with a number", around39, () => 1);
observe("Bun.stringWidth(t)" + " with methods", around39, withMethods);
observe("Bun.stringWidth(t)" + " with a proxy", around39, trapped);
observe("Bun.stringWidth(t)" + " with a proxy of a function", around39, trappedFunction);
observe("(process.env.IMPOSTOR_OPERAND = t, delete process.env.IMPOSTOR_OPERAND)" + " with a number", around40, () => 1);
observe("(process.env.IMPOSTOR_OPERAND = t, delete process.env.IMPOSTOR_OPERAND)" + " with methods", around40, withMethods);
observe("(process.env.IMPOSTOR_OPERAND = t, delete process.env.IMPOSTOR_OPERAND)" + " with a proxy", around40, trapped);
observe("(process.env.IMPOSTOR_OPERAND = t, delete process.env.IMPOSTOR_OPERAND)" + " with a proxy of a function", around40, trappedFunction);
