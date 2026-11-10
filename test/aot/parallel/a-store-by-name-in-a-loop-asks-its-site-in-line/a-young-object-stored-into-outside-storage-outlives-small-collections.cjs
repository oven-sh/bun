// The barrier behind the store outside the cell: the old object alone holds what the loop stores.
// STATISTIC: StoresByNameThatAskTheirSitesInLine >= 2
"use strict";
function fill(crates, turns, given) { let sum = 0; for (let i = 0; i < turns; i++) { const crate = crates[i % crates.length]; crate.lid = given === undefined ? i : given; sum = (sum + i) | 0; } return sum; }
function plain(n) { return JSON.parse("[" + Array.from({ length: n }, () => '{"hinge":1,"lid":0}').join(",") + "]"); }
function wide(n) { const o = JSON.parse('{"hinge":1}'); for (let k = 0; k < n; k++) o["pad" + k] = k; o.lid = 0; o.tail = "t"; return o; }
const said = [];
function tell(what) { try { said.push(String(what())); } catch (error) { said.push(error.constructor.name + ": " + error.message); } }
const crates = [wide(40), wide(40), wide(40), wide(40)]; tell(() => fill(crates, 3000)); Bun.gc(true); Bun.gc(true);
function keep(turns) { for (let i = 0; i < turns; i++) { const crate = crates[i & 3]; crate.lid = { deep: i, more: [i, i + 1] }; } }
function churn(turns) { let last = null; for (let i = 0; i < turns; i++) last = { a: i, b: [i, i], c: "x" + i }; return last.a; }
for (let round = 0; round < 6; round++) { tell(() => keep(4000)); tell(() => churn(400000)); tell(() => crates.map(c => c.lid.deep + ":" + c.lid.more.join("+")).join(",")); }
console.log(said.join(" | "));
