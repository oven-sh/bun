"use strict";
const n = Number(process.argv[2] ?? 3);
class Base { constructor(given) { return given; } }
function make(v) {
  const table = Object.create(null);
  table.plain = v;
  class Stamp extends Base { #x = 1; static mark(k) { new Stamp(table); table.#x = k; return table.#x + table.plain; } }
  return Stamp.mark(v) + Object.keys(table).join();
}
console.log(make(n));
