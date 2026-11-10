"use strict";
const n = Number(process.argv[2] ?? 3);
class Base { constructor(given) { return given; } }
class Stamp extends Base { #x = 1; static mark(k) { const t = Object.create(null); t.plain = k; new Stamp(t); t.#x += 1; t.#x++; [t.#x] = [t.#x + 4]; ({ y: t.#x } = { y: t.#x + 5 }); return t.#x + t.plain; } }
console.log(Stamp.mark(n));
