// A function that is full because it gets a property loses it in the stub too.
// COUNT: operation:operationAOTDeleteByNameSloppy <= 1400
function flag(callback, i) { callback.flagged = i; const result = callback(i); delete callback.flagged; return result; }
let sum = 0;
for (let i = 0; i < 1000; i++) sum += flag(x => x + i, i);
console.log(sum);
function debounce(i) { const f = function () { return i; }; f.cancel = () => { i = 0; }; f.flush = i; delete f.flush; return f; }
const keys = new Set();
for (let i = 0; i < 500; i++) { const f = debounce(i); f.cancel(); sum += f(); delete f.cancel; keys.add(Object.getOwnPropertyNames(f).join() + f.cancel); }
console.log(sum, [...keys].join(" | "));
function named(i) { const f = function inner(a, b) { return i; }; f.extra = i; return [delete f.name, f.name, delete f.length, f.length, delete f.extra, f.extra, (() => { try { "use strict"; return delete f.prototype; } catch (error) { return error.constructor.name; } })(), Object.getOwnPropertyNames(f).join()].join(); }
const rows = new Set();
for (let i = 0; i < 100; i++) rows.add(named(i));
console.log([...rows].join(" | "));
function fixed(i) { const f = () => i; Object.defineProperty(f, "still", { value: i, configurable: false }); f.gone = 1; return [delete f.still, f.still === i, delete f.gone, "gone" in f].join(); }
const fixedRows = new Set();
for (let i = 0; i < 100; i++) fixedRows.add(fixed(i));
console.log([...fixedRows].join(" | "));
function inherits(i) { const base = function () {}; base.shared = i; const f = function () {}; f.shared = 0; Object.setPrototypeOf(f, base); return [delete f.shared, f.shared === i, delete f.shared, f.shared === i, delete base.shared, f.shared].join(); }
const inherited = new Set();
for (let i = 0; i < 100; i++) inherited.add(inherits(i));
console.log([...inherited].join(" | "));
