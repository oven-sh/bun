// What a program stores on an object of a class of Bun's own library, known by its layout, gets a slot in the cell. The object answers as a plain one would. THE DEED: each object gets some of the names.
const { EventEmitter } = require("node:events");
const { Readable } = require("node:stream");
const attempt = (f) => { try { return f(); } catch (e) { return e.constructor.name; } };
function list(o) {
  const listed = [];
  for (const key in o) if (!key.startsWith("_")) listed.push(key);
  return [Object.keys(o).filter((k) => !k.startsWith("_")).join("+"), listed.join("+"), o.first, o.second, o.third, Object.hasOwn(o, "first"), "second" in o, o.listenerCount("x")].join();
}
function make(i) { const e = new EventEmitter(); if (i & 1) e.first = i; if (i & 2) e.second = i; if (i & 4) e.third = i; return e; }
for (let i = 0; i < 8; i++) console.log(i, list(make(i)));
