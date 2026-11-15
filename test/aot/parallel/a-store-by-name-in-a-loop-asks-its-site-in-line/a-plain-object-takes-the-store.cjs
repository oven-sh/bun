// The store that the code in line performs: the word of the name and no other.
// STATISTIC: SiteCachedStoresEmittedInline >= 1
"use strict";
function fill(crates, turns, given) { let sum = 0; for (let i = 0; i < turns; i++) { const crate = crates[i % crates.length]; crate.lid = given === undefined ? i : given; sum = (sum + i) | 0; } return sum; }
function plain(n) { return JSON.parse("[" + Array.from({ length: n }, () => '{"hinge":1,"lid":0}').join(",") + "]"); }
const said = [];
function tell(what) { try { said.push(String(what())); } catch (error) { said.push(error.constructor.name + ": " + error.message); } }
const crates = plain(3); tell(() => fill(crates, 5000)); tell(() => crates.map(c => c.lid + ":" + c.hinge + ":" + Object.keys(c)).join(","));
console.log(said.join(" | "));
