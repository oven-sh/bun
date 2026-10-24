// Object.getOwnPropertyDescriptor and Reflect.getOwnPropertyDescriptor whose result is only taken apart, and whose result is asked what only a real object can answer: which fields it has, in which order, whether it is the same object; on data properties, accessors, properties that are not there, frozen objects, lists, strings, functions, typed arrays, proxies, null and undefined.
const log = [];
class Point { constructor(x) { this.x = x; } get double() { return this.x * 2; } static origin = 0; }
const withAccessor = { get a() { return 1; }, set a(v) {}, get onlyGet() { return 2; }, set onlySet(v) {} };
const hidden = Object.defineProperty({}, "h", { value: undefined, enumerable: false, writable: false, configurable: false });
const trapped = new Proxy({ t: 1 }, { getOwnPropertyDescriptor(target, key) { log.push("trap " + String(key)); return Reflect.getOwnPropertyDescriptor(target, key); } });
const sym = Symbol("s");
const subjects = () => [[new Point(1), "x"], [new Point(1), "double"], [Point.prototype, "double"], [Point, "origin"], [Point, "prototype"], [Point, "name"], [{ x: 5, z: 1 }, "x"], [{ x: 5 }, "y"], [withAccessor, "a"], [withAccessor, "onlyGet"], [withAccessor, "onlySet"], [hidden, "h"], [Object.freeze({ f: 1 }), "f"], [Object.seal({ s: 1 }), "s"], [[1, 2], "length"], [[1, 2], "0"], [[1, 2], 1], [[1, 2], 5], ["text", "length"], ["text", 0], ["text", "9"], [function f(a, b) {}, "length"], [() => 1, "name"], [() => 1, "prototype"], [new Uint8Array(2), "0"], [new Uint8Array(2), "7"], [trapped, "t"], [trapped, "u"], [{ [sym]: 1 }, sym], [5, "x"], [true, "x"], [null, "x"], [undefined, "x"], [{ value: 1, get: 2 }, "value"], [globalThis, "undefined"], [Math, "PI"], [new Map(), "size"], [Map.prototype, "size"], [{ k: 1 }, { toString() { log.push("key"); return "k"; } }]];
function attempt(run) { try { return String(run()); } catch (e) { return e.constructor.name; } }
const gopd = Object.getOwnPropertyDescriptor;
const forms = {
  value: (o, k) => Object.getOwnPropertyDescriptor(o, k).value,
  valueGuarded: (o, k) => { const d = Object.getOwnPropertyDescriptor(o, k); return d ? d.value : "none"; },
  optional: (o, k) => Object.getOwnPropertyDescriptor(o, k)?.value,
  enumerable: (o, k) => { let d; return !(d = Object.getOwnPropertyDescriptor(o, k)) || d.enumerable; },
  all: (o, k) => { const d = Object.getOwnPropertyDescriptor(o, k); return d === undefined ? "none" : [typeof d.value, d.writable, typeof d.get, typeof d.set, d.enumerable, d.configurable].join(); },
  getter: (o, k) => { const d = Object.getOwnPropertyDescriptor(o, k); return d && d.get ? typeof d.get.call(o) : "no getter"; },
  other: (o, k) => { const d = Object.getOwnPropertyDescriptor(o, k); return d && [d.toString === Object.prototype.toString, d.nothing, d.constructor === Object].join(); },
  alias: (o, k) => { const d = gopd(o, k); return d && d.writable; },
  reflect: (o, k) => { const d = Reflect.getOwnPropertyDescriptor(o, k); return d ? typeof d.value + d.configurable : "none"; },
  has: (o, k) => { const d = Object.getOwnPropertyDescriptor(o, k); return d && ["value" in d, "get" in d, "writable" in d, Object.hasOwn(d, "set"), d.hasOwnProperty("enumerable")].join(); },
  keys: (o, k) => { const d = Object.getOwnPropertyDescriptor(o, k); return d && Object.keys(d).join(); },
  spread: (o, k) => { const d = Object.getOwnPropertyDescriptor(o, k); return d && JSON.stringify({ ...d, value: typeof d.value }); },
  forIn: (o, k) => { const d = Object.getOwnPropertyDescriptor(o, k); let s = ""; for (const n in d) s += n + ";"; return s; },
  written: (o, k) => { const d = Object.getOwnPropertyDescriptor(o, k); if (!d) return "none"; d.value = 7; d.extra = 8; return [d.value, d.extra, Object.keys(d).join()].join(); },
  defined: (o, k) => { const d = Object.getOwnPropertyDescriptor(o, k); if (!d) return "none"; const t = Object.defineProperty({}, "p", d); return Object.keys(Object.getOwnPropertyDescriptor(t, "p")).join(); },
  identity: (o, k) => { const d = Object.getOwnPropertyDescriptor(o, k); return d === Object.getOwnPropertyDescriptor(o, k); },
  destructured: (o, k) => { const { value, get = "no get", enumerable } = Object.getOwnPropertyDescriptor(o, k) ?? {}; return [typeof value, typeof get, enumerable].join(); },
  kept: (o, k) => { const d = Object.getOwnPropertyDescriptor(o, k); log.push(d ? 1 : 0); return d && d.value === undefined && d.get === undefined; },
};
for (const name in forms) {
  let line = "";
  for (let round = 0; round < 30; round++) { log.length = 0; line = subjects().map(([o, k]) => attempt(() => forms[name](o, k))).join(" | ") + " || " + log.join(","); }
  console.log(name + ": " + line);
}
