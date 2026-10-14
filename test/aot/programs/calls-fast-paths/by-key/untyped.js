"use strict";
function Emitter() { this._events = { __proto__: null }; }
Emitter.prototype.on = function (type, f) { this._events[type] = f; return this; };
Emitter.prototype.emit = function (type, a) { const handler = this._events[type]; if (handler === undefined) return 0; return handler.call(this, a); };
function listener(a) { return a + 1; }
function run(n) { const e = new Emitter(); e.on("tick", listener); let s = 0; for (let i = 0; i < n; i++) s += e.emit("tick", i & 3); return s; }
module.exports = { run };
