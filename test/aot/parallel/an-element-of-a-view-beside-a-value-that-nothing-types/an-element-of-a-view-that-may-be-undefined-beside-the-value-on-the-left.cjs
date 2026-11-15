"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const view = new Float64Array([1.5, -2, 0, 4]), show = x => Object.is(x, -0) ? "-0" : typeof x + " " + String(x);
const values = JSON.parse('[3, 2.5, -0.5, 0, "4", "x", null, true, [5], {}]');
function times(m, at, v) { return v * m[at]; }
function less(m, at, v) { return v - m[at]; }
function over(m, at, v) { return v / m[at]; }
for (const at of [0, 1, 2, 3, 4, 9 + more]) for (const v of values) said.push(at + " " + JSON.stringify(v) + ": " + show(times(view, at, v)) + " | " + show(less(view, at, v)) + " | " + show(over(view, at, v)));
console.log(said.join("\n"));
