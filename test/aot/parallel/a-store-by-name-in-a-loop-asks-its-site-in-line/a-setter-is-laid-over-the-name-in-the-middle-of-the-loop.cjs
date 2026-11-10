// The structure changes within the loop: the data word becomes an accessor.
// STATISTIC: SiteCachedStoresEmittedInline >= 1
"use strict";
function fill(crates, turns, given) { let sum = 0; for (let i = 0; i < turns; i++) { const crate = crates[i % crates.length]; crate.lid = given === undefined ? i : given; sum = (sum + i) | 0; } return sum; }
function plain(n) { return JSON.parse("[" + Array.from({ length: n }, () => '{"hinge":1,"lid":0}').join(",") + "]"); }
const said = [];
function tell(what) { try { said.push(String(what())); } catch (error) { said.push(error.constructor.name + ": " + error.message); } }
const crates = plain(2); let heard = 0;
function fillAndChange(turns) { for (let i = 0; i < turns; i++) { const crate = crates[i & 1]; crate.lid = i; if (i === 2001) Object.defineProperty(crates[0], "lid", { set(v) { heard += v; }, get() { return -1; }, configurable: true }); } }
tell(() => fillAndChange(4000)); tell(() => heard); tell(() => crates.map(c => c.lid).join(","));
console.log(said.join(" | "));
