function Counter() { Object.defineProperty(this, "n", { value: 0, writable: true, enumerable: false, configurable: false }); }
Counter.prototype.bump = function () { return ++this.n; };
function Emitter() { Object.defineProperties(this, { _events: { value: {}, writable: true, enumerable: false, configurable: true }, _count: { value: 0, writable: true, enumerable: false, configurable: true } }); }
Emitter.prototype.reset = function () { this._events = Object.create(null); this._count = 0; };
Emitter.prototype.on = function (k, f) { (this._events[k] ||= []).push(f); this._count++; return this; };
const c = new Counter(); for (let i = 0; i < 1000; i++) c.bump(); console.log(c.n, Object.keys(c).length);
const e = new Emitter(); for (let i = 0; i < 100; i++) { if (i % 30 === 0) e.reset(); e.on("a" + (i % 3), () => i); } console.log(e._count, Object.keys(e._events).join(), Object.keys(e).length, JSON.stringify(e));
const any = (o, k, v) => { o[k] = v; return Object.keys(o).length; };
console.log(any(e, "_count", 5), any(e, "z", 1), any(c, "n", 2), e._count, c.n);
class S extends Error { constructor() { super("m"); Object.defineProperty(this, "code", { value: 1, writable: true, enumerable: false, configurable: true }); } set(v) { this.code = v; } }
const s = new S(); s.set(2); s.set("x"); console.log(s.code, Object.keys(s).length);
"use strict";
try { const f = Object.freeze(new Counter()); f.bump(); } catch (x) { console.log(x.message); }
