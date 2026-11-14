// A function has no room in its cell: one shape, and its word lies outside.
// STATISTIC: SiteCachedStoresEmittedInline >= 1
"use strict";
function fill(crates, turns, given) { let sum = 0; for (let i = 0; i < turns; i++) { const crate = crates[i % crates.length]; crate.lid = given === undefined ? i : given; sum = (sum + i) | 0; } return sum; }
function plain(n) { return JSON.parse("[" + Array.from({ length: n }, () => '{"hinge":1,"lid":0}').join(",") + "]"); }
function wide(n) { const o = JSON.parse('{"hinge":1}'); for (let k = 0; k < n; k++) o["pad" + k] = k; o.lid = 0; o.tail = "t"; return o; }
const said = [];
function tell(what) { try { said.push(String(what())); } catch (error) { said.push(error.constructor.name + ": " + error.message); } }
const space = JSON.parse("{}"); space.Maker = function () { this.id = 1; }; space.Maker.count = 1; new space.Maker();
function raise(turns) { let sum = 0; for (let i = 0; i < turns; i++) { space.Maker.count += 1; sum += space.Maker.count & 3; } return sum; }
tell(() => raise(6000)); tell(() => space.Maker.count); tell(() => Object.keys(space.Maker).join(","));
console.log(said.join(" | "));
