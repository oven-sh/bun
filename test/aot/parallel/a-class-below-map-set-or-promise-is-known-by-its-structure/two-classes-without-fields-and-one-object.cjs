"use strict";
const far = v => [v][JSON.parse("0")];
const turns = Number(process.argv[2] ?? 300); let sum = 0;
class H extends Map { hue() { return 1; } }
class K extends Map { kay() { return 2; } }
const h = new H(), k = new K();
function f(a, b) { let n = 0; for (let i = 0; i < 16; i++) { const x = a.hue(); Object.setPrototypeOf(a, K.prototype); const y = b.kay(); if (a === b) n += x + y; Object.setPrototypeOf(a, H.prototype); } return n; }
for (let t = 0; t < turns; t++) sum += f(far(h), far(h));
console.log(sum, k.kay());
