"use strict";
function Emitter() { this._events = { __proto__: null }; }
Emitter.prototype.on = function (type, f) { const had = this._events[type]; if (had === undefined) this._events[type] = f; else if (typeof had === "function") this._events[type] = [had, f]; else had.push(f); return this; };
Emitter.prototype.emit = function (type, a) {
  const handler = this._events[type];
  if (handler === undefined) return "none";
  if (typeof handler === "function") return handler.call(this, a);
  let s = ""; for (let i = 0; i < handler.length; i++) s += handler[i].call(this, a) + ";"; return s;
};
function first(a) { return "first " + a; }
function second(a) { return "second " + a; }
function usesThis(a) { return (this instanceof Emitter) + " " + a; }
function fireOnly(e, a) { return e.emit("only", a); }
function fireShared(e, a) { return e.emit("shared", a); }
function fireThis(e, a) { return e.emit("self", a); }
function fireComputed(e, type, a) { return e.emit(type, a); }
module.exports = { Emitter, first, second, usesThis, fireOnly, fireShared, fireThis, fireComputed };
