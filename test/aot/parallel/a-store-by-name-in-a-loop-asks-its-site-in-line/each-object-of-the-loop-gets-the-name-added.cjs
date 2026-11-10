// The record at the site says "add the name" for good: the code in line leaves at its first question.
// STATISTIC: SiteCachedStoresEmittedInline >= 1
"use strict";
function fill(crates, turns, given) { let sum = 0; for (let i = 0; i < turns; i++) { const crate = crates[i % crates.length]; crate.lid = given === undefined ? i : given; sum = (sum + i) | 0; } return sum; }
function plain(n) { return JSON.parse("[" + Array.from({ length: n }, () => '{"hinge":1,"lid":0}').join(",") + "]"); }
function wide(n) { const o = JSON.parse('{"hinge":1}'); for (let k = 0; k < n; k++) o["pad" + k] = k; o.lid = 0; o.tail = "t"; return o; }
const said = [];
function tell(what) { try { said.push(String(what())); } catch (error) { said.push(error.constructor.name + ": " + error.message); } }
const crates = JSON.parse("[" + Array.from({ length: 3000 }, (_, k) => '{"hinge":' + k + "}").join(",") + "]"); tell(() => fill(crates, 3000)); tell(() => crates.filter((c, k) => c.lid !== k || Object.keys(c).join() !== "hinge,lid").length);
const far = Array.from({ length: 600 }, () => { const o = wide(40); delete o.tail; delete o.lid; return o; }); tell(() => fill(far, 600)); tell(() => far.filter((c, k) => c.lid !== k || c.pad39 !== 39).length);
console.log(said.join(" | "));
