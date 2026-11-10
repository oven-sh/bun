// The structure changes within the loop: the object is frozen.
// STATISTIC: StoresByNameThatAskTheirSitesInLine >= 1
"use strict";
function fill(crates, turns, given) { let sum = 0; for (let i = 0; i < turns; i++) { const crate = crates[i % crates.length]; crate.lid = given === undefined ? i : given; sum = (sum + i) | 0; } return sum; }
function plain(n) { return JSON.parse("[" + Array.from({ length: n }, () => '{"hinge":1,"lid":0}').join(",") + "]"); }
const said = [];
function tell(what) { try { said.push(String(what())); } catch (error) { said.push(error.constructor.name + ": " + error.message); } }
const crates = plain(2);
function fillAndFreeze(turns) { let last = -1; for (let i = 0; i < turns; i++) { const crate = crates[i & 1]; crate.lid = i; last = i; if (i === 2500) Object.freeze(crates[1]); } return last; }
tell(() => fillAndFreeze(4000)); tell(() => crates.map(c => c.lid).join(","));
console.log(said.join(" | "));
