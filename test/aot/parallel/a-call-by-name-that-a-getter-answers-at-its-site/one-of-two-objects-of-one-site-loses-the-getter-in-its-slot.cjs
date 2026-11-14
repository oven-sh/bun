"use strict";
function add(a, b) { return (a + b) | 0; }
function less(a, b) { return (a - b) | 0; }
const make = () => { const made = Object.create({}); Object.defineProperty(made, "add", { enumerable: true, configurable: true, get: function () { return add; } }); return made; };
const first = make(), second = make();
function drive(stretch) { let s = 0; const marks = []; for (let i = 0; i < 2 * stretch; i++) { if (i === stretch) delete second.add; try { s = (s + first.add(i & 31, 3) + (i & 1 ? first : second).add(i & 31, 1)) | 0; } catch (error) { s = (s + 7) | 0; } if (i % stretch === stretch - 1) marks.push(s); } return marks.join(" "); }
console.log(drive(+(process.argv[2] ?? 5000)));
