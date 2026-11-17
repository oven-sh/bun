// What stands in front of a loop: any value in a loop by the counter.
"use strict";
const said = []; const tell = (make) => { try { said.push(String(make())); } catch (e) { said.push(e.constructor.name); } };
function go(turns, held, flag) { let sum = 0; for (let t = 0; t < turns; t++) sum += held[t]; return sum; }
const all = () => [null, undefined, 5, "text", {}, { length: 2, 0: 4, 1: 5 }, [1.5, 2.5], new Float64Array([3.5, 4.5]), new Int8Array([6, 7])];
for (const turns of JSON.parse("[0, 0, 2]")) for (const flag of JSON.parse("[false, true]")) for (const at of JSON.parse("[0, 1, 2, 3, 4, 5, 6, 7, 8]")) tell(() => go(turns, all()[at], flag));
console.log("SAID " + said.join(" "));
