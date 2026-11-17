// What a program stores on an object of a class of Bun's own library, known by its layout, gets a slot in the cell. The object answers as a plain one would. THE DEED: the object is frozen, sealed or closed in front of the stores or behind them.
const { EventEmitter } = require("node:events");
const { Readable } = require("node:stream");
const attempt = (f) => { try { return f(); } catch (e) { return e.constructor.name; } };
function list(o) {
  const listed = [];
  for (const key in o) if (!key.startsWith("_")) listed.push(key);
  return [Object.keys(o).filter((k) => !k.startsWith("_")).join("+"), listed.join("+"), o.first, o.second, o.third, Object.hasOwn(o, "first"), "second" in o, o.listenerCount("x")].join();
}
"use strict";
function lay(e) { return [attempt(() => { e.first = 1; return "first"; }), attempt(() => { e.second = 2; return "second"; }), attempt(() => { e.third = 3; return "third"; })].join(); }
for (const close of [Object.freeze, Object.seal, Object.preventExtensions]) {
  const early = close(new EventEmitter()); console.log(lay(early), attempt(() => list(early)));
  const late = new EventEmitter(); lay(late); close(late); console.log(lay(late), attempt(() => { delete late.first; return "deleted"; }), attempt(() => list(late)), Object.isFrozen(late), Object.isSealed(late));
}
