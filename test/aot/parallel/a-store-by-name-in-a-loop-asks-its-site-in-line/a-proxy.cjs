// One of the objects is a Proxy whose trap stores another value, and one whose trap says no.
// STATISTIC: StoresByNameThatAskTheirSitesInLine >= 1
"use strict";
function fill(crates, turns, given) { let sum = 0; for (let i = 0; i < turns; i++) { const crate = crates[i % crates.length]; crate.lid = given === undefined ? i : given; sum = (sum + i) | 0; } return sum; }
function plain(n) { return JSON.parse("[" + Array.from({ length: n }, () => '{"hinge":1,"lid":0}').join(",") + "]"); }
const said = [];
function tell(what) { try { said.push(String(what())); } catch (error) { said.push(error.constructor.name + ": " + error.message); } }
const crates = plain(3); tell(() => fill(crates, 3000)); const seen = [];
crates.push(new Proxy(JSON.parse('{"hinge":1,"lid":0}'), { set(target, name, v) { if (seen.length < 3) seen.push(String(name) + "=" + v); target[name] = v + 1; return true; } }));
tell(() => fill(crates, 4000)); tell(() => seen.join(",")); tell(() => crates.map(c => c.lid).join(","));
crates.push(new Proxy(JSON.parse('{"lid":0}'), { set() { return false; } })); tell(() => fill(crates, 4000)); tell(() => crates.map(c => c.lid).join(","));
console.log(said.join(" | "));
