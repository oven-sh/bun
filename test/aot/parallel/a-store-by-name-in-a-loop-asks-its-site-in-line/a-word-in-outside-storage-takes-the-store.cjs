// The record names a word outside the cell: the words beside it stay as they are, in objects, lists and functions.
// STATISTIC: StoresByNameThatAskTheirSitesInLine >= 1
"use strict";
function fill(crates, turns, given) { let sum = 0; for (let i = 0; i < turns; i++) { const crate = crates[i % crates.length]; crate.lid = given === undefined ? i : given; sum = (sum + i) | 0; } return sum; }
function plain(n) { return JSON.parse("[" + Array.from({ length: n }, () => '{"hinge":1,"lid":0}').join(",") + "]"); }
function wide(n) { const o = JSON.parse('{"hinge":1}'); for (let k = 0; k < n; k++) o["pad" + k] = k; o.lid = 0; o.tail = "t"; return o; }
const said = [];
function tell(what) { try { said.push(String(what())); } catch (error) { said.push(error.constructor.name + ": " + error.message); } }
const crates = [wide(40), wide(40), wide(40)]; tell(() => fill(crates, 6000)); tell(() => crates.map(c => [c.lid, c.pad39, c.pad38, c.tail, c.pad0, c.hinge].join(":")).join(","));
const lists = [[1, 2], [3, 4], [5, 6]]; for (const c of lists) { c.before = "b"; c.lid = 0; c.behind = "h"; } tell(() => fill(lists, 6000)); tell(() => lists.map(c => [c.lid, c.before, c.behind, c.length, c[0], c[1]].join(":")).join(","));
const functions = [function a() {}, function b() {}]; for (const c of functions) { c.before = "b"; c.lid = 0; c.behind = "h"; } tell(() => fill(functions, 6000)); tell(() => functions.map(c => [c.lid, c.before, c.behind, c.name].join(":")).join(","));
console.log(said.join(" | "));
