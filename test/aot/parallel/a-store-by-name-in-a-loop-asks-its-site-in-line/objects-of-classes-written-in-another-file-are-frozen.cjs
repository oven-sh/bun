// A compiled object says in its own words that it is frozen: its structure does not.
// STATISTIC: StoresByNameThatAskTheirSitesInLine >= 1
"use strict";
const { every, Coffer, Locker, through } = require("./lib-classes-that-list-the-name.cjs");
function fill(crates, turns, given) { let sum = 0; for (let i = 0; i < turns; i++) { const crate = crates[i % crates.length]; crate.lid = given === undefined ? i : given; sum = (sum + i) | 0; } return sum; }
function plain(n) { return JSON.parse("[" + Array.from({ length: n }, () => '{"hinge":1,"lid":0}').join(",") + "]"); }
const said = [];
function tell(what) { try { said.push(String(what())); } catch (error) { said.push(error.constructor.name + ": " + error.message); } }
const crates = every(1).concat(plain(2)); tell(() => fill(crates, 8000)); for (const c of crates) if (!(c instanceof Coffer)) Object.freeze(c);
for (let k = 0; k < 8; k++) { const one = [crates[k]]; tell(() => fill(one, 50)); } tell(() => crates.map(c => c.lid).join(","));
const late = every(2).concat(plain(2));
function fillAndFreeze(turns) { let last = -1; for (let i = 0; i < turns; i++) { const crate = late[i & 7]; crate.lid = i; last = i; if (i === 4003) Object.freeze(late[4]); } return last; }
tell(() => fillAndFreeze(8000)); tell(() => late.map(c => c.lid).join(","));
console.log(said.join(" | "));
