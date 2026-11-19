"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const view = new Float64Array([1.5, -2, 0, 4]), show = x => Object.is(x, -0) ? "-0" : typeof x + " " + String(x);
const values = [1n, -2n, 0n, Symbol("s"), Object(3n), { valueOf() { return 4n; } }];
function times(m, at, v) { return m[at] * v; }
function less(m, at, v) { return v - m[at]; }
function over(m, at, v) { return m[at] / v; }
for (const at of [0, 4, 9 + more]) for (const v of values) for (const f of [times, less, over]) { try { said.push(f.name + " " + at + ": " + show(f(view, at, v))); } catch (error) { said.push(f.name + " " + at + ": " + error.constructor.name + ": " + error.message); } }
console.log(said.join("\n"));
