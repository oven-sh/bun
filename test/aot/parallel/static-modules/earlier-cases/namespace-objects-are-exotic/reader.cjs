"use strict";
const show = (f) => { try { return String(f()); } catch (e) { return e.constructor.name; } };
exports.odd = function () {
  const t = require("./t");
  const lines = [];
  lines.push("tag: " + String(t[Symbol.toStringTag]) + " " + Object.prototype.toString.call(t));
  lines.push("extensible: " + Object.isExtensible(t) + " sealed: " + Object.isSealed(t) + " frozen: " + Object.isFrozen(t));
  lines.push("prototype: " + String(Object.getPrototypeOf(t) === Object.prototype) + " " + show(() => Object.setPrototypeOf(t, {})) + " " + typeof t.toString + " " + typeof t.hasOwnProperty);
  lines.push("symbols: " + Object.getOwnPropertySymbols(t).map(String).join() + " " + Reflect.ownKeys(t).length + " " + show(() => Reflect.set(t, "n", 1)) + " " + show(() => Reflect.defineProperty(t, "n", { value: t.n })) + " " + show(() => Reflect.defineProperty(t, "n", { value: t.n, writable: false })) + " " + show(() => Reflect.deleteProperty(t, "nope")));
  lines.push("sloppy write: " + show(() => { t.n = 99; return t.n; }) + " new: " + show(() => { t.fresh = 1; return t.fresh; }));
  lines.push("strict write: " + show(function () { "use strict"; t.n = 98; return t.n; }) + " new: " + show(function () { "use strict"; t.fresh2 = 1; return t.fresh2; }));
  lines.push("delete: " + show(() => delete t.n) + " " + show(function () { "use strict"; return delete t.n; }) + " " + ("n" in t));
  const d = Object.getOwnPropertyDescriptor(t, "n");
  lines.push("descriptor: " + Object.keys(d).sort().join() + " " + d.enumerable + " " + d.configurable + " " + String(d.writable));
  lines.push("define the tag: " + show(() => Reflect.defineProperty(t, Symbol.toStringTag, { writable: false })) + " " + show(() => Reflect.defineProperty(t, Symbol.toStringTag, { value: "Other" })) + " " + show(() => Reflect.defineProperty(t, Symbol.iterator, { value: 1 })));
  lines.push("define: " + show(() => { Object.defineProperty(t, "n", { value: 5 }); return t.n; }));
  return lines;
};
