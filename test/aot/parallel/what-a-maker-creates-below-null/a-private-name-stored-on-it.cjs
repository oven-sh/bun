"use strict";
const n = Number(process.argv[2] ?? 3);
class Box {
  #x = 1;
  static make(i) { const r = Object.create(null); r.plain = i; try { r.#x = 2; } catch (error) { r.kind = error.constructor.name; } return r; }
  static has(o) { return #x in o; }
}
const made = Box.make(n);
console.log(JSON.stringify(made), Box.has(made), Object.keys(made).join(), made["#x"], "#x" in Box.make(n));
