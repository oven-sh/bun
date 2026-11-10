"use strict";
const n = Number(process.argv[2] ?? 3);
class Base { constructor(given) { return given; } }
class Stamp extends Base { #x = 1; static mark(k) { new Stamp(table); table.#x = k; return table.#x + table.plain; } }
const table = Object.create(null);
table.plain = n;
console.log(Stamp.mark(n), Object.keys(table).join(), "#x" in table);
