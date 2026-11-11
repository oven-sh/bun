// What stands in front of a loop: a const list parsed at run time read in a loop ahead of its store.
"use strict";
const said = []; const tell = (make) => { try { said.push(String(make())); } catch (e) { said.push(e.constructor.name); } };
function total(turns) { let sum = 0; for (let t = 0; t < turns; t++) sum += table[t]; return sum; }
for (const turns of JSON.parse("[0, 0, 1]")) tell(() => total(turns));
const table = JSON.parse("[1.5, 2.5]");
tell(() => total(2));
console.log("SAID " + said.join(" "));
