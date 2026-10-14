"use strict";
function lengthOnly(...args) { return args.length; }
function firstOnly(...args) { return args[0]; }
function sum(...args) { let s = 0; for (let i = 0; i < args.length; i++) s += args[i]; return s; }
function fail(self, list) { throw new Error("never " + list.length); }
function handler(a, b) { return (a | 0) + (b | 0) + 1; }
function dispatch(type, ...args) {
  if (type === "error") return fail(this, args);
  switch (args.length) {
    case 0: return handler.call(this);
    case 1: return handler.call(this, args[0]);
    case 2: return handler.call(this, args[0], args[1]);
    default: return handler.apply(this, args);
  }
}
function viaArguments(a) { return arguments.length + arguments[1] + a; }
function copies() { var out = 0; for (var i = 0; i < arguments.length; i++) out += arguments[i]; return out; }
function inHandler(f, ...args) { try { return f(); } catch (e) { return args.length + args[0]; } }
module.exports = { lengthOnly, firstOnly, sum, dispatch, viaArguments, copies, inHandler };
