"use strict";
const said = [], more = process.argv.length > 99 ? 1 : 0;
const view = new Float64Array([1.5, -2, 0, 4]), show = x => Object.is(x, -0) ? "-0" : typeof x + " " + String(x);
const own = new Float64Array([2, 3]); let calls = 0;
const writer = { valueOf() { calls++; own[0] = 100; own[1] = 200; return 10; } };
function times(m, at, v) { return m[at] * v; }
function both(m, v) { return m[0] * v + m[1] * v + (v - m[5 + more]); }
said.push(show(times(own, 0, writer)), show(own[0]), String(calls)); own[0] = 2; own[1] = 3;
said.push(show(both(own, writer)), String(calls));
const thrower = { valueOf() { calls++; throw new RangeError("from valueOf"); } };
for (const at of [0, 7]) { try { said.push(show(times(own, at, thrower))); } catch (error) { said.push(error.name + " " + calls); } }
console.log(said.join("\n"));
