// Object.defineProperties(target, Object.getOwnPropertyDescriptors(source)): every form of property, onto targets that have, lack or refuse the names.
"use strict";
const s = Symbol("s");
function list(o) {
  return Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ("value" in d ? "=" + String(d.value) + (d.writable ? "W" : "w") : "(" + (d.get ? "G" : "g") + (d.set ? "S" : "s") + ")") + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c"); }).join(" ");
}
class Point { constructor() { this.x = 1; this.y = 2; } }
class Other { constructor() { this.y = "y"; this.n = "n"; } get inherited() { return 1; } }
function source(turn) {
  const o = { x: turn, get y() { return turn; }, set y(v) {}, n: "text", [s]: turn, 3: "three" };
  Object.defineProperty(o, "hidden", { value: turn, writable: true, configurable: true });
  Object.defineProperty(o, "fixed", { value: turn });
  Object.defineProperty(o, "readOnly", { value: turn, enumerable: true, configurable: true });
  Object.defineProperty(o, "getter", { get() { return turn; } });
  Object.defineProperty(o, "setter", { set(v) {}, enumerable: true });
  return o;
}
const copy = (target, from) => { try { return Object.defineProperties(target, Object.getOwnPropertyDescriptors(from)) === target; } catch (e) { return e.constructor.name + ": " + e.message; } };
const targets = [
  () => ({}), () => ({ x: 0, y: 0 }), () => new Point(), () => new Other(), () => Object.create(null), () => function f() {}, () => [],
  () => Object.preventExtensions({ x: 0 }), () => Object.seal({ x: 0, y: 0, n: 0 }), () => Object.freeze({ x: 0 }),
  () => Object.defineProperty({ a: 1 }, "fixed", { value: "mine" }), () => Object.defineProperty({ a: 1 }, "hidden", { get() { return 1; }, configurable: true }),
  () => Object.defineProperty(new Point(), "x", { writable: false }), () => Object.create(new Point()),
];
for (let turn = 0; turn < 4; turn++) {
  for (let index = 0; index < targets.length; index++) {
    const target = targets[index]();
    console.log(turn, index, copy(target, source(turn)), "#", list(target));
    console.log(turn, index, copy(target, new Point()), copy(target, new Other()), copy(target, "ab"), copy(target, [turn]), "#", list(target));
  }
  if (turn === 1) Bun.gc(true);
}
