// The name is made read-only on one object: strict code throws.
// STATISTIC: StoresByNameThatAskTheirSitesInLine >= 1
"use strict";
function fill(crates, turns, given) { let sum = 0; for (let i = 0; i < turns; i++) { const crate = crates[i % crates.length]; crate.lid = given === undefined ? i : given; sum = (sum + i) | 0; } return sum; }
function plain(n) { return JSON.parse("[" + Array.from({ length: n }, () => '{"hinge":1,"lid":0}').join(",") + "]"); }
const said = [];
function tell(what) { try { said.push(String(what())); } catch (error) { said.push(error.constructor.name + ": " + error.message); } }
const crates = plain(3); tell(() => fill(crates, 3000)); Object.defineProperty(crates[1], "lid", { writable: false });
tell(() => fill(crates, 4000)); tell(() => crates.map(c => c.lid).join(","));
console.log(said.join(" | "));
