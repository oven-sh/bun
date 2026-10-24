// `e._events[type]` with a key that is constant after inlining, where the stored function is not the predicted one.
// @ts-ignore
import untyped from "./untyped.js";
declare const console: any;
const m: any = untyped;
const out: string[] = [];
const attempt = (f: () => any) => { try { out.push(String(f())); } catch (e: any) { out.push("threw " + e.constructor.name); } };
for (let round = 0; round < 2; round++) {
  const e = new m.Emitter();
  attempt(() => m.fireOnly(e, 0));
  e.on("only", m.first); attempt(() => m.fireOnly(e, 1));
  e.on("self", m.usesThis); attempt(() => m.fireThis(e, 2));
  // Two functions under one key in two emitters: nothing is expected.
  const other = new m.Emitter(); e.on("shared", m.first); other.on("shared", m.second); attempt(() => m.fireShared(e, 3)); attempt(() => m.fireShared(other, 4));
  // The expected one, twice: an array.
  e.on("only", m.first); attempt(() => m.fireOnly(e, 5));
  // What no store by `on` put there.
  e._events.only = m.second; attempt(() => m.fireOnly(e, 6));
  e._events["only"] = (a: any) => "arrow " + a; attempt(() => m.fireOnly(e, 7));
  e._events.only = m.first.bind(null, "bound"); attempt(() => m.fireOnly(e, 8));
  e._events.only = Math.abs; attempt(() => m.fireOnly(e, -9));
  e._events.only = class K {}; attempt(() => m.fireOnly(e, 10));
  e._events.only = new Proxy(m.first, {}); attempt(() => m.fireOnly(e, 11));
  e._events.only = 5; attempt(() => m.fireOnly(e, 12));
  e._events.only = null; attempt(() => m.fireOnly(e, 13));
  e._events.only = { length: 1, 0: m.second }; attempt(() => m.fireOnly(e, 14));
  delete e._events.only; attempt(() => m.fireOnly(e, 15));
  // The dictionary itself is another, or none.
  e._events = { only: m.second }; attempt(() => m.fireOnly(e, 16));
  e._events = { get only() { return m.first; } }; attempt(() => m.fireOnly(e, 17));
  e._events = Object.create({ only: m.first }); attempt(() => m.fireOnly(e, 18));
  e._events = new Proxy({}, { get: (_t, k) => (a: any) => "proxy " + String(k) + a }); attempt(() => m.fireOnly(e, 19));
  e._events = [m.first]; attempt(() => m.fireOnly(e, 20));
  e._events = "only"; attempt(() => m.fireOnly(e, 21));
  e._events = undefined; attempt(() => m.fireOnly(e, 22));
  // A receiver that is not an Emitter.
  attempt(() => m.fireOnly({ emit: m.Emitter.prototype.emit, _events: { only: m.second } }, 23)); attempt(() => m.fireOnly({ emit: () => "own emit" }, 24));
  // A key that is not a constant.
  const f = new m.Emitter().on("only", m.first).on("x", m.second); for (const type of ["only", "x", "y", "__proto__", "constructor", 0, Symbol.iterator]) attempt(() => m.fireComputed(f, type, 25));
}
console.log(out.join("\n"));
export {};
