// What a program stores on an object of a class of Bun's own library, known by its layout, gets a slot in the cell. The object answers as a plain one would. THE DEED: a class of the program extends that of the library, and names are laid on objects of both.
const { EventEmitter } = require("node:events");
const { Readable } = require("node:stream");
const attempt = (f) => { try { return f(); } catch (e) { return e.constructor.name; } };
function list(o) {
  const listed = [];
  for (const key in o) if (!key.startsWith("_")) listed.push(key);
  return [Object.keys(o).filter((k) => !k.startsWith("_")).join("+"), listed.join("+"), o.first, o.second, o.third, Object.hasOwn(o, "first"), "second" in o, o.listenerCount("x")].join();
}
class Mine extends EventEmitter { constructor() { super(); this.own = 0; } }
function make() { const e = new Mine(); e.first = 1; e.second = 2; return e; }
function plain() { const e = new EventEmitter(); e.second = 1; e.third = 2; return e; }
for (let turn = 0; turn < 3; turn++) console.log(list(make()), make().own, list(plain()));
