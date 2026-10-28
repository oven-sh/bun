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
  void (Array.prototype.includes.call(t, 1));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around2(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Array.prototype.reverse.call(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around3(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Array.prototype.concat.call([], t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around4(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Array.prototype.at.call(t, 0));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around5(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Uint8Array(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around6(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Uint8Array(2).fill(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around7(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Uint8Array(2).set(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around8(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Uint8Array(2).set([1], t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around9(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Uint8Array(2)[0] = t);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around10(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Uint8Array(2)[t]);
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around11(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Uint8Array(2).subarray(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around12(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Uint8Array(2).slice(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around13(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Uint8Array(2).at(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around14(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Uint8Array(2).indexOf(0, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around15(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Uint8Array(2).join(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around16(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Uint8Array(2).with(t, 0));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around17(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Uint8Array.from(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around18(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Uint8Array.of(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around19(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new Float64Array([t]));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around20(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new ArrayBuffer(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around21(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new ArrayBuffer(8).slice(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around22(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new DataView(new ArrayBuffer(8), t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around23(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new DataView(new ArrayBuffer(8)).getInt8(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around24(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new DataView(new ArrayBuffer(8)).setInt8(0, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around25(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (new DataView(new ArrayBuffer(8)).getInt16(0, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around26(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Atomics.load(new Int32Array(2), t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around27(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Atomics.add(new Int32Array(2), 0, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around28(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Buffer.from(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around29(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Buffer.alloc(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around30(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Buffer.alloc(2, t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around31(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Buffer.alloc(2).fill(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around32(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Buffer.alloc(2).readUInt8(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around33(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Buffer.alloc(2).toString(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around34(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Buffer.alloc(2).slice(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around35(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Buffer.alloc(2).write(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around36(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Buffer.alloc(2).indexOf(t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

function around37(o, a, t) {
  const before = [o.y, a[0], shared].join(" ");
  void (Buffer.concat([Buffer.alloc(1)], t));
  return before + " / " + [o.y, a[0], shared].join(" ");
}

console.log("strict:", (function () { return this === undefined; })());
observe("Array.prototype.includes.call(t, 1)" + " with a number", around1, () => 1);
observe("Array.prototype.includes.call(t, 1)" + " with methods", around1, withMethods);
observe("Array.prototype.includes.call(t, 1)" + " with a proxy", around1, trapped);
observe("Array.prototype.includes.call(t, 1)" + " with a proxy of a function", around1, trappedFunction);
observe("Array.prototype.reverse.call(t)" + " with a number", around2, () => 1);
observe("Array.prototype.reverse.call(t)" + " with methods", around2, withMethods);
observe("Array.prototype.reverse.call(t)" + " with a proxy", around2, trapped);
observe("Array.prototype.reverse.call(t)" + " with a proxy of a function", around2, trappedFunction);
observe("Array.prototype.concat.call([], t)" + " with a number", around3, () => 1);
observe("Array.prototype.concat.call([], t)" + " with methods", around3, withMethods);
observe("Array.prototype.concat.call([], t)" + " with a proxy", around3, trapped);
observe("Array.prototype.concat.call([], t)" + " with a proxy of a function", around3, trappedFunction);
observe("Array.prototype.at.call(t, 0)" + " with a number", around4, () => 1);
observe("Array.prototype.at.call(t, 0)" + " with methods", around4, withMethods);
observe("Array.prototype.at.call(t, 0)" + " with a proxy", around4, trapped);
observe("Array.prototype.at.call(t, 0)" + " with a proxy of a function", around4, trappedFunction);
observe("new Uint8Array(t)" + " with a number", around5, () => 1);
observe("new Uint8Array(t)" + " with methods", around5, withMethods);
observe("new Uint8Array(t)" + " with a proxy", around5, trapped);
observe("new Uint8Array(t)" + " with a proxy of a function", around5, trappedFunction);
observe("new Uint8Array(2).fill(t)" + " with a number", around6, () => 1);
observe("new Uint8Array(2).fill(t)" + " with methods", around6, withMethods);
observe("new Uint8Array(2).fill(t)" + " with a proxy", around6, trapped);
observe("new Uint8Array(2).fill(t)" + " with a proxy of a function", around6, trappedFunction);
observe("new Uint8Array(2).set(t)" + " with a number", around7, () => 1);
observe("new Uint8Array(2).set(t)" + " with methods", around7, withMethods);
observe("new Uint8Array(2).set(t)" + " with a proxy", around7, trapped);
observe("new Uint8Array(2).set(t)" + " with a proxy of a function", around7, trappedFunction);
observe("new Uint8Array(2).set([1], t)" + " with a number", around8, () => 1);
observe("new Uint8Array(2).set([1], t)" + " with methods", around8, withMethods);
observe("new Uint8Array(2).set([1], t)" + " with a proxy", around8, trapped);
observe("new Uint8Array(2).set([1], t)" + " with a proxy of a function", around8, trappedFunction);
observe("new Uint8Array(2)[0] = t" + " with a number", around9, () => 1);
observe("new Uint8Array(2)[0] = t" + " with methods", around9, withMethods);
observe("new Uint8Array(2)[0] = t" + " with a proxy", around9, trapped);
observe("new Uint8Array(2)[0] = t" + " with a proxy of a function", around9, trappedFunction);
observe("new Uint8Array(2)[t]" + " with a number", around10, () => 1);
observe("new Uint8Array(2)[t]" + " with methods", around10, withMethods);
observe("new Uint8Array(2)[t]" + " with a proxy", around10, trapped);
observe("new Uint8Array(2)[t]" + " with a proxy of a function", around10, trappedFunction);
observe("new Uint8Array(2).subarray(t)" + " with a number", around11, () => 1);
observe("new Uint8Array(2).subarray(t)" + " with methods", around11, withMethods);
observe("new Uint8Array(2).subarray(t)" + " with a proxy", around11, trapped);
observe("new Uint8Array(2).subarray(t)" + " with a proxy of a function", around11, trappedFunction);
observe("new Uint8Array(2).slice(t)" + " with a number", around12, () => 1);
observe("new Uint8Array(2).slice(t)" + " with methods", around12, withMethods);
observe("new Uint8Array(2).slice(t)" + " with a proxy", around12, trapped);
observe("new Uint8Array(2).slice(t)" + " with a proxy of a function", around12, trappedFunction);
observe("new Uint8Array(2).at(t)" + " with a number", around13, () => 1);
observe("new Uint8Array(2).at(t)" + " with methods", around13, withMethods);
observe("new Uint8Array(2).at(t)" + " with a proxy", around13, trapped);
observe("new Uint8Array(2).at(t)" + " with a proxy of a function", around13, trappedFunction);
observe("new Uint8Array(2).indexOf(0, t)" + " with a number", around14, () => 1);
observe("new Uint8Array(2).indexOf(0, t)" + " with methods", around14, withMethods);
observe("new Uint8Array(2).indexOf(0, t)" + " with a proxy", around14, trapped);
observe("new Uint8Array(2).indexOf(0, t)" + " with a proxy of a function", around14, trappedFunction);
observe("new Uint8Array(2).join(t)" + " with a number", around15, () => 1);
observe("new Uint8Array(2).join(t)" + " with methods", around15, withMethods);
observe("new Uint8Array(2).join(t)" + " with a proxy", around15, trapped);
observe("new Uint8Array(2).join(t)" + " with a proxy of a function", around15, trappedFunction);
observe("new Uint8Array(2).with(t, 0)" + " with a number", around16, () => 1);
observe("new Uint8Array(2).with(t, 0)" + " with methods", around16, withMethods);
observe("new Uint8Array(2).with(t, 0)" + " with a proxy", around16, trapped);
observe("new Uint8Array(2).with(t, 0)" + " with a proxy of a function", around16, trappedFunction);
observe("Uint8Array.from(t)" + " with a number", around17, () => 1);
observe("Uint8Array.from(t)" + " with methods", around17, withMethods);
observe("Uint8Array.from(t)" + " with a proxy", around17, trapped);
observe("Uint8Array.from(t)" + " with a proxy of a function", around17, trappedFunction);
observe("Uint8Array.of(t)" + " with a number", around18, () => 1);
observe("Uint8Array.of(t)" + " with methods", around18, withMethods);
observe("Uint8Array.of(t)" + " with a proxy", around18, trapped);
observe("Uint8Array.of(t)" + " with a proxy of a function", around18, trappedFunction);
observe("new Float64Array([t])" + " with a number", around19, () => 1);
observe("new Float64Array([t])" + " with methods", around19, withMethods);
observe("new Float64Array([t])" + " with a proxy", around19, trapped);
observe("new Float64Array([t])" + " with a proxy of a function", around19, trappedFunction);
observe("new ArrayBuffer(t)" + " with a number", around20, () => 1);
observe("new ArrayBuffer(t)" + " with methods", around20, withMethods);
observe("new ArrayBuffer(t)" + " with a proxy", around20, trapped);
observe("new ArrayBuffer(t)" + " with a proxy of a function", around20, trappedFunction);
observe("new ArrayBuffer(8).slice(t)" + " with a number", around21, () => 1);
observe("new ArrayBuffer(8).slice(t)" + " with methods", around21, withMethods);
observe("new ArrayBuffer(8).slice(t)" + " with a proxy", around21, trapped);
observe("new ArrayBuffer(8).slice(t)" + " with a proxy of a function", around21, trappedFunction);
observe("new DataView(new ArrayBuffer(8), t)" + " with a number", around22, () => 1);
observe("new DataView(new ArrayBuffer(8), t)" + " with methods", around22, withMethods);
observe("new DataView(new ArrayBuffer(8), t)" + " with a proxy", around22, trapped);
observe("new DataView(new ArrayBuffer(8), t)" + " with a proxy of a function", around22, trappedFunction);
observe("new DataView(new ArrayBuffer(8)).getInt8(t)" + " with a number", around23, () => 1);
observe("new DataView(new ArrayBuffer(8)).getInt8(t)" + " with methods", around23, withMethods);
observe("new DataView(new ArrayBuffer(8)).getInt8(t)" + " with a proxy", around23, trapped);
observe("new DataView(new ArrayBuffer(8)).getInt8(t)" + " with a proxy of a function", around23, trappedFunction);
observe("new DataView(new ArrayBuffer(8)).setInt8(0, t)" + " with a number", around24, () => 1);
observe("new DataView(new ArrayBuffer(8)).setInt8(0, t)" + " with methods", around24, withMethods);
observe("new DataView(new ArrayBuffer(8)).setInt8(0, t)" + " with a proxy", around24, trapped);
observe("new DataView(new ArrayBuffer(8)).setInt8(0, t)" + " with a proxy of a function", around24, trappedFunction);
observe("new DataView(new ArrayBuffer(8)).getInt16(0, t)" + " with a number", around25, () => 1);
observe("new DataView(new ArrayBuffer(8)).getInt16(0, t)" + " with methods", around25, withMethods);
observe("new DataView(new ArrayBuffer(8)).getInt16(0, t)" + " with a proxy", around25, trapped);
observe("new DataView(new ArrayBuffer(8)).getInt16(0, t)" + " with a proxy of a function", around25, trappedFunction);
observe("Atomics.load(new Int32Array(2), t)" + " with a number", around26, () => 1);
observe("Atomics.load(new Int32Array(2), t)" + " with methods", around26, withMethods);
observe("Atomics.load(new Int32Array(2), t)" + " with a proxy", around26, trapped);
observe("Atomics.load(new Int32Array(2), t)" + " with a proxy of a function", around26, trappedFunction);
observe("Atomics.add(new Int32Array(2), 0, t)" + " with a number", around27, () => 1);
observe("Atomics.add(new Int32Array(2), 0, t)" + " with methods", around27, withMethods);
observe("Atomics.add(new Int32Array(2), 0, t)" + " with a proxy", around27, trapped);
observe("Atomics.add(new Int32Array(2), 0, t)" + " with a proxy of a function", around27, trappedFunction);
observe("Buffer.from(t)" + " with a number", around28, () => 1);
observe("Buffer.from(t)" + " with methods", around28, withMethods);
observe("Buffer.from(t)" + " with a proxy", around28, trapped);
observe("Buffer.from(t)" + " with a proxy of a function", around28, trappedFunction);
observe("Buffer.alloc(t)" + " with a number", around29, () => 1);
observe("Buffer.alloc(t)" + " with methods", around29, withMethods);
observe("Buffer.alloc(t)" + " with a proxy", around29, trapped);
observe("Buffer.alloc(t)" + " with a proxy of a function", around29, trappedFunction);
observe("Buffer.alloc(2, t)" + " with a number", around30, () => 1);
observe("Buffer.alloc(2, t)" + " with methods", around30, withMethods);
observe("Buffer.alloc(2, t)" + " with a proxy", around30, trapped);
observe("Buffer.alloc(2, t)" + " with a proxy of a function", around30, trappedFunction);
observe("Buffer.alloc(2).fill(t)" + " with a number", around31, () => 1);
observe("Buffer.alloc(2).fill(t)" + " with methods", around31, withMethods);
observe("Buffer.alloc(2).fill(t)" + " with a proxy", around31, trapped);
observe("Buffer.alloc(2).fill(t)" + " with a proxy of a function", around31, trappedFunction);
observe("Buffer.alloc(2).readUInt8(t)" + " with a number", around32, () => 1);
observe("Buffer.alloc(2).readUInt8(t)" + " with methods", around32, withMethods);
observe("Buffer.alloc(2).readUInt8(t)" + " with a proxy", around32, trapped);
observe("Buffer.alloc(2).readUInt8(t)" + " with a proxy of a function", around32, trappedFunction);
observe("Buffer.alloc(2).toString(t)" + " with a number", around33, () => 1);
observe("Buffer.alloc(2).toString(t)" + " with methods", around33, withMethods);
observe("Buffer.alloc(2).toString(t)" + " with a proxy", around33, trapped);
observe("Buffer.alloc(2).toString(t)" + " with a proxy of a function", around33, trappedFunction);
observe("Buffer.alloc(2).slice(t)" + " with a number", around34, () => 1);
observe("Buffer.alloc(2).slice(t)" + " with methods", around34, withMethods);
observe("Buffer.alloc(2).slice(t)" + " with a proxy", around34, trapped);
observe("Buffer.alloc(2).slice(t)" + " with a proxy of a function", around34, trappedFunction);
observe("Buffer.alloc(2).write(t)" + " with a number", around35, () => 1);
observe("Buffer.alloc(2).write(t)" + " with methods", around35, withMethods);
observe("Buffer.alloc(2).write(t)" + " with a proxy", around35, trapped);
observe("Buffer.alloc(2).write(t)" + " with a proxy of a function", around35, trappedFunction);
observe("Buffer.alloc(2).indexOf(t)" + " with a number", around36, () => 1);
observe("Buffer.alloc(2).indexOf(t)" + " with methods", around36, withMethods);
observe("Buffer.alloc(2).indexOf(t)" + " with a proxy", around36, trapped);
observe("Buffer.alloc(2).indexOf(t)" + " with a proxy of a function", around36, trappedFunction);
observe("Buffer.concat([Buffer.alloc(1)], t)" + " with a number", around37, () => 1);
observe("Buffer.concat([Buffer.alloc(1)], t)" + " with methods", around37, withMethods);
observe("Buffer.concat([Buffer.alloc(1)], t)" + " with a proxy", around37, trapped);
observe("Buffer.concat([Buffer.alloc(1)], t)" + " with a proxy of a function", around37, trappedFunction);
