// The descriptor is an object with a layout of its own, not a literal at the call: reused, changed between calls, with members added, removed, redefined or computed.
"use strict";
const list = o => Reflect.ownKeys(o).map(k => { const d = Object.getOwnPropertyDescriptor(o, k); return String(k) + ("value" in d ? "=" + String(d.value) + (d.writable ? "W" : "w") : "(" + (d.get ? "G" + String(d.get.call(o)) : "g") + (d.set ? "S" : "s") + ")") + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c"); }).join(" ");
const log = [];
function define(target, key, descriptor) { try { Object.defineProperty(target, key, descriptor); return "ok"; } catch (e) { return e.constructor.name + ":" + e.message; } }
function reflect(target, key, descriptor) { try { return String(Reflect.defineProperty(target, key, descriptor)); } catch (e) { return e.constructor.name + ":" + e.message; } }
const shared = { value: undefined, enumerable: false };
const full = { value: 1, writable: true, enumerable: true, configurable: true };
const accessor = { get() { return "got"; }, set(v) { log.push(v); }, enumerable: true, configurable: false };
class Described { constructor(v) { this.value = v; this.enumerable = true; } }
class Inheriting { constructor(v) { this.value = v; } get enumerable() { log.push("read enumerable"); return true; } }
const makers = [
  turn => { shared.value = turn; return shared; },
  turn => { full.value = turn; full.writable = turn % 2 === 0; return full; },
  turn => accessor,
  turn => { const d = { value: turn }; d.enumerable = 1; d.configurable = "yes"; d.writable = 0; return d; },
  turn => { const d = { value: turn, enumerable: true, writable: true }; delete d.enumerable; return d; },
  turn => { const d = { value: turn, enumerable: true }; delete d.value; return d; },
  turn => { const d = { value: turn, enumerable: true }; Object.defineProperty(d, "enumerable", { get() { log.push("getter ran"); return false; } }); return d; },
  turn => { const d = { value: turn, enumerable: true }; Object.defineProperty(d, "value", { value: "hidden", enumerable: false }); return d; },
  turn => Object.freeze({ value: turn, configurable: true }),
  turn => new Described(turn),
  turn => new Inheriting(turn),
  turn => ({ value: undefined, writable: undefined, enumerable: null, configurable: NaN }),
  turn => ({ get: undefined, set: undefined, enumerable: {} }),
  turn => ({ get: turn % 2 ? undefined : () => turn, configurable: true }),
  turn => { const d = { enumerable: true }; d.get = function () { return this === undefined ? "none" : "late getter"; }; return d; },
  turn => { const d = { value: turn }; d.get = () => 1; return d; },
  turn => { const d = { writable: true }; d.set = v => {}; return d; },
  turn => ({ get: 5 }),
  turn => ({ set: "text" }),
  turn => { const d = { value: turn }; d[0] = "index"; d[Symbol.iterator] = 1; d.other = 2; return d; },
  turn => { const d = {}; for (const k of ["configurable", "value", "enumerable"]) d[k] = k === "value" ? turn : true; return d; },
  turn => Object.assign({ value: 0 }, { value: turn, enumerable: true }),
  turn => ({ ...full, value: turn }),
  turn => JSON.parse('{"value":' + turn + ',"enumerable":true}'),
  turn => Object.setPrototypeOf({ value: turn }, { enumerable: true }),
  turn => Object.setPrototypeOf({ value: turn }, null),
  turn => Object.getOwnPropertyDescriptor({ k: turn }, "k"),
  turn => Object.getOwnPropertyDescriptor({ get k() { return turn; } }, "k"),
];
class Point { constructor() { this.x = 1; } }
for (let turn = 0; turn < 4; turn++) {
  for (let m = 0; m < makers.length; m++) {
    const results = [];
    for (const target of [{ a: 1 }, new Point(), Object.create(null)]) {
      results.push(define(target, "n", makers[m](turn)), reflect(target, "a", makers[m](turn + 10)), list(target));
      try { Object.defineProperties(target, { p: makers[m](turn), q: makers[(m + 1) % makers.length](turn) }); results.push("ok"); } catch (e) { results.push(e.constructor.name); }
      results.push(list(target));
    }
    console.log(turn, m, results.join(" | "), log.splice(0).join());
  }
  if (turn === 1) Bun.gc(true);
}
