// The answers of get traps for targets that are frozen, sealed or not extensible, with extra properties that came, that went and that never were.
"use strict";
class Point { constructor(a, b) { this.a = a; this.b = b; } }
function literal(k) { return { a: k, b: "b" + k }; }
const handlers = [{ get(target, key) { return target[key]; } }, { get(target, key, receiver) { return Reflect.get(target, key, receiver); } }, { get(target, key) { return "other"; } }, { get(target, key) { return key === "a" ? 99 : target[key]; } }];
const changes = [
  (t) => t,
  (t, k) => { t["x" + k] = 1; return t; },
  (t, k) => { t["x" + k] = 1; delete t["x" + k]; return t; },
  (t, k) => { t["x" + k] = 1; t.y = 2; delete t["x" + k]; delete t.y; return t; },
  (t) => Object.defineProperty(t, "z", { value: 5, configurable: false }),
  (t) => Object.defineProperty(t, "z", { get() { return 6; }, configurable: true }),
  (t) => Object.defineProperty(t, "z", { get: undefined, set() {}, configurable: false }),
  (t) => Object.defineProperty(t, "a", { value: 7, writable: false, configurable: false }),
];
const locks = [(t) => t, Object.freeze, Object.seal, Object.preventExtensions];
const keys = ["a", "b", "z", "x1", "missing", "toString"];
function read(proxy, key) { try { const v = proxy[key]; return typeof v === "function" ? "f" : String(v); } catch (error) { return error.constructor.name; } }
for (let round = 0; round < 6; round++) {
  for (const make of [literal, (k) => new Point(k, "p")]) for (const change of changes) for (const lock of locks) {
    const target = lock(change(make(round), round & 1));
    const line = [];
    for (const handler of handlers) { const proxy = new Proxy(target, handler); for (const key of keys) line.push(read(proxy, key)); }
    console.log(line.join());
  }
}
