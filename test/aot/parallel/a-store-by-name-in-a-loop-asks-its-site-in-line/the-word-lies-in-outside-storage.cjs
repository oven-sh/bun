// The name is the forty-second of the object: its word lies outside the cell.
// STATISTIC: SiteCachedStoresEmittedInline >= 1
"use strict";
function fill(crates, turns, given) { let sum = 0; for (let i = 0; i < turns; i++) { const crate = crates[i % crates.length]; crate.lid = given === undefined ? i : given; sum = (sum + i) | 0; } return sum; }
function plain(n) { return JSON.parse("[" + Array.from({ length: n }, () => '{"hinge":1,"lid":0}').join(",") + "]"); }
const said = [];
function tell(what) { try { said.push(String(what())); } catch (error) { said.push(error.constructor.name + ": " + error.message); } }
const wide = () => { const o = JSON.parse('{"hinge":1}'); for (let k = 0; k < 40; k++) o["pad" + k] = k; o.lid = 0; return o; };
const crates = [wide(), wide(), wide()]; tell(() => fill(crates, 5000)); tell(() => crates.map(c => c.lid + ":" + c.pad39 + ":" + c.pad0 + ":" + c.hinge).join(","));
const mixed = plain(2).concat([wide()]); tell(() => fill(mixed, 5000)); tell(() => mixed.map(c => c.lid + ":" + c.hinge).join(","));
console.log(said.join(" | "));
