// Members that appear late on the prototypes of primitives and of built-in classes.
function id(x) { return x; }
function chain(x) { return id(id(id(id(id(id(id(id(x)))))))); }
function show(...parts) { let text = ""; for (let i = 0; i < parts.length; i++) text += (i ? " | " : "") + String(parts[i]); console.log(text); }
function dynamic(text) { return (text + "!").slice(0, text.length); }
// 1: a number, a boolean, a symbol, a bigint as receivers
{ function r(v) { return v.late; } show("1a", r(5), r(true), r(Symbol.iterator), r(5n));
  chain(Number.prototype).late = "number"; show("1b", r(5).length, r(true));
  Object.defineProperty(chain(Boolean.prototype), "late", { get() { return typeof this; }, configurable: true }); show("1c", r(true));
  chain(Symbol.prototype).late = 1; chain(BigInt.prototype).late = [1]; show("1d", r(Symbol.iterator) + 1, r(5n).length); }
// 3: another kind of primitive arrives late at a read that was seen
{ function r(v) { return v.toFixed; } show("3a", typeof r(1)); show("3b", typeof r(chain("text")), typeof r(chain(true))); }
// 4: a store on a primitive runs a setter that appears late
{ const log = []; function w(v, x) { try { v.sink = x; } catch (e) { log.push("threw"); } } w(5, 1);
  Object.defineProperty(chain(Number.prototype), "sink", { set(x) { log.push(typeof this + ":" + x); }, configurable: true }); w(5, 2); show("4", log.join()); delete Number.prototype.sink; }
// 8: an own property hides a member of the table
{ function size(v) { return v.size; } const m = new Map([[1, 1]]); show("8a", size(m) + 1); Object.defineProperty(chain(m), "size", { value: "own" }); show("8b", size(m).length, size(new Map()) + 1); }
// 9: the prototype of a built-in prototype changes late
{ function r(v) { return v.above; } const e = new TypeError("t"); show("9a", r(e)); const original = Object.getPrototypeOf(TypeError.prototype);
  Object.setPrototypeOf(chain(TypeError.prototype), { above: "new link" }); show("9b", r(e).length); Object.setPrototypeOf(TypeError.prototype, original); }
// 10: characters and length of strings under keys that grow
{ function g(s, k) { return s[k]; } show("10a", g("abc", 0)); show("10b", g("abc", chain("length")) + 1, g("abc", chain(7)), typeof g("abc", chain("at"))); }
