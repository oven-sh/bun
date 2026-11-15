// Loops over top-level variables of text loaded at run time, before they are initialized, behind a store from elsewhere, read-only, shadowed.
const vm = require("vm");
const lines = [];
globalThis.note = (k, f) => { let s; try { s = f(); s = Object.is(s, -0) ? "-0" : String(s); } catch (e) { s = e.name + ": " + e.message; } lines.push(k + " " + s); };
const texts = [
  `note("early let", () => early); note("early store", () => { early = 1; }); let early = 5; note("late let", () => early++ + early);`,
  `var sum = 0; for (var i = 0; i < 100; i++) { sum += i % 7; } note("sum", () => sum + i);`,
  `let product = 1; for (let k = 1; k < 40; k++) { product = (product * 1103515245 + 12345) & 0x7fffffff; } note("product", () => product);`,
  `note("again", () => { sum *= 46341; sum *= 46341; return sum; }); note("shadow", () => { let sum = 2; return sum; });`,
  `note("zero", () => { let l = []; for (const a of [0, -5, 7, -0, 2147483648, -2147483648]) for (const b of [0, -0, 7, -1, 3, 2147483647, -2147483648]) l.push(Object.is(a * b, -0), Object.is(a % b, -0), a * b, a % b); return l.join(); });`,
  `note("integers", () => { let l = []; for (const a of [0, -5, 7, -7, 2147483647, -2147483648]) for (const b of [0, 7, -1, 3, -3, 65536, 2147483647, -2147483648]) l.push(Object.is(a * b, -0), Object.is(a % b, -0), a * b, a % b, a + b, a - b); return l.join(); });`,
  `note("large", () => { let l = []; for (const a of [4294967296, -4294967296, 9007199254740991, 1e300, 0.5, 9223372036854775808, -9223372036854775808, NaN, Infinity, 4611686018427387904]) for (const b of [4294967295, 7, -7, 0.25, 2147483648, 9223372036854775808, Infinity, NaN]) l.push(a * b, a % b, Object.is(a % b, -0)); return l.join(); });`,
  `const fixed = 3; note("const", () => { fixed = 4; }); note("const read", () => fixed);`,
  `Object.defineProperty(globalThis, "sum", { writable: false }); note("read-only", () => { sum = 1; return sum; }); note("strict", () => { "use strict"; sum = 1; });`,
  `implicit = 1; note("implicit", () => { for (let k = 0; k < 9; k++) implicit += k; return implicit; }); delete globalThis.implicit; note("deleted", () => implicit); note("typeof", () => typeof implicit);`,
  `Object.defineProperty(globalThis, "accessor", { get() { return 8; }, set(v) { note("set", () => v); }, configurable: true }); note("accessor", () => { accessor = 4; return accessor; });`,
];
const hidden = t => [t, "0"][process.argv.length > 90 ? 1 : 0];
for (const t of texts) { try { vm.runInThisContext(hidden(t)); } catch (e) { lines.push(e.name + ": " + e.message); } }
const read = vm.runInThisContext(hidden(`(function () { return typeof implicit + i + product; })`));
for (let k = 0; k < 4; k++) { globalThis.implicit = k; globalThis.i = k; lines.push(read()); }
vm.runInThisContext(hidden(`let late = 1; note("shadowed", () => { try { return later; } catch (e) { return e.name; } });`));
globalThis.later = "property";
const readLater = vm.runInThisContext(hidden(`(function () { return later; })`)), storeLater = vm.runInThisContext(hidden(`(function (v) { later = v; })`));
for (let k = 0; k < 3; k++) { storeLater(k); lines.push(readLater() + " " + globalThis.later); }
vm.runInThisContext(hidden(`let later = "lexical";`));
for (let k = 0; k < 3; k++) { lines.push(readLater() + " " + globalThis.later); storeLater("s" + k); lines.push(readLater() + " " + globalThis.later); }
console.log(lines.join("\n"));
