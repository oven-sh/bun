// The literal of a default meets what callers pass: objects that lack names, strings, heirs, getters.
'use strict';
function shape(x, { width = "", height, depth, tint = x } = {}) { return x + width.length + (tint === x ? 1 : 0) + (height || 0) + (depth === undefined ? 0 : 7); }
const table = { shape }, key = JSON.parse('"shape"'), given = { width: 'q', height: 1 };
function run(turns, g) { let s = 0; const h = table[key]; for (let i = 0; i < turns; i++) s += h(i, g); return s; }
console.log(run(30, given), run(3), run(3, { width: "ab" }), run(3, "text"), run(3, 5), run(3, { __proto__: given, depth: 1 }), run(3, Object.create(given)), run(3, { get width() { return "getter"; }, tint: 2 }));
try { run(1, null); } catch (e) { console.log(e.name); }
given.depth = 4; console.log(run(30, given)); delete given.width; console.log(run(30, given)); Object.setPrototypeOf(given, { width: "above" }); console.log(run(30, given)); Object.freeze(given); console.log(run(30, given));
/* Output:
525 6 12 6 6 33 12 22
TypeError
735
705
855
855
*/
