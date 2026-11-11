"use strict";
function add(a, b) { return (a + b) | 0; }
function less(a, b) { return (a - b) | 0; }
const created = Object.create({});
Object.defineProperty(created, "add", { enumerable: true, configurable: true, get: function () { return add; } });
globalThis.shown = created;
const change = (0, eval)("(function (less) { Object.defineProperty(globalThis.shown, 'add', { enumerable: true, configurable: true, writable: true, value: less }); })");
function drive(stretch) { let s = 0; const marks = []; for (let i = 0; i < 2 * stretch; i++) { if (i === stretch) change(less); s = (s + created.add(i & 31, 3)) | 0; if (i % stretch === stretch - 1) marks.push(s); } return marks.join(" "); }
console.log(drive(+(process.argv[2] ?? 5000)));
