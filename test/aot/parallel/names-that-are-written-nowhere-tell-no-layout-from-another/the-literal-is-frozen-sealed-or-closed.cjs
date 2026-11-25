"use strict";
// Frozen, sealed and non-extensible objects read as they are.
function shape(width, { label = "", depth, tint, edge = width } = {}) { return String(width) + "|" + label + "|" + String(depth) + "|" + String(tint) + "|" + String(edge); }
const table = { count(s) { return s.length + 1; }, text(s) { return String(s); }, wrap(s) { return [s]; }, kind(s) { return typeof s; }, none(s) { return s === null; }, shape }, key = JSON.parse('"shape"');
const said = [];
function tell(...given) { try { said.push(table[key](...given)); } catch (error) { said.push(error.name); } }
function make(i) { return { label: "q", depth: i }; }
for (let round = 0; round < 3; round++) { tell(round, Object.freeze(make(round))); tell(round, Object.seal(make(round))); tell(round, Object.preventExtensions(make(round))); }
console.log(said.join(" "));
