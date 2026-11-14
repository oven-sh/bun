// Handlers of one layout keep their traps in the same fields. A new proxy begins with what was found in another handler, and asks its own handler for each value.
// COUNTER: ProxyHandlerTrapsCopied >= 30
"use strict";
const attempt = f => { try { return String(f()); } catch (e) { return e.name + ": " + e.message; } };
const list = p => Object.keys(p).join() + "|" + Reflect.ownKeys(p).map(String).join() + "|" + JSON.stringify(Object.getOwnPropertyDescriptor(p, "a")) + "|" + Reflect.isExtensible(p) + "|" + (Reflect.getPrototypeOf(p) === Object.prototype) + "|" + Reflect.deleteProperty(p, "gone") + "|" + Reflect.defineProperty(p, "b", { value: 2, configurable: true, enumerable: true });
function wrap(target, log) {
  return { get: (t, k) => (log.push("g" + String(k)), t[k]), set: (t, k, v) => { log.push("s" + k); t[k] = v; return true; }, has: (t, k) => k in t };
}
class Handler { constructor(keys, described) { this.ownKeys = keys; this.getOwnPropertyDescriptor = described; } }
const log = [];
for (let round = 0; round < 12; round++) console.log(round, attempt(() => list(new Proxy({ a: round, c: 3 }, wrap({}, log)))), log.splice(0).join());
// The same layout with other values: a trap, undefined, null, nothing that can be called, an empty field, a deleted one, an appended one.
const keys = [t => ["a"], undefined, null, t => Reflect.ownKeys(t), () => ["a", "a"], 5, t => ["c", "a"]];
const described = [undefined, () => undefined, (t, k) => Reflect.getOwnPropertyDescriptor(t, k), undefined, () => ({ value: 1, configurable: true }), undefined, null];
for (let round = 0; round < 28; round++) {
  const handler = new Handler(keys[round % 7], described[round * 3 % 7]);
  if (round % 9 === 4) delete handler.ownKeys;
  if (round % 9 === 5) handler.isExtensible = () => true;
  if (round % 9 === 6) Object.freeze(handler);
  if (round % 9 === 7) Object.defineProperty(handler, "ownKeys", { get() { log.push("asked"); return undefined; } });
  if (round % 9 === 8) Object.setPrototypeOf(handler, { getPrototypeOf: () => Array.prototype });
  const p = new Proxy({ a: 1, c: 3 }, handler);
  console.log(round, attempt(() => list(p)), attempt(() => list(p)), log.splice(0).join());
  console.log(attempt(() => { handler.ownKeys = () => ["late"]; }), attempt(() => list(p)));
  console.log(attempt(() => delete handler.getOwnPropertyDescriptor), attempt(() => list(p)));
}
function optional(some) { const h = { get: undefined, ownKeys: undefined }; if (some & 1) h.ownKeys = () => ["o"]; if (some & 2) h.deleteProperty = () => false; if (some & 4) h["de" + "fineProperty"] = () => true; return h; }
for (let round = 0; round < 24; round++) console.log(attempt(() => list(new Proxy({ a: round }, optional(round % 8)))));
for (let round = 0; round < 6; round++) {
  const callable = new Proxy(function (a) { return a; }, wrap({}, log));
  console.log(attempt(() => callable(round)), attempt(() => typeof new callable(1)), attempt(() => Object.keys(callable).join()));
}
