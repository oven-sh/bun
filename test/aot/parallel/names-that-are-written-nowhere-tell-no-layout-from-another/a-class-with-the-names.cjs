"use strict";
// An instance with the names as fields, one with them as accessors above.
function shape(width, { label = "", depth, tint, edge = width } = {}) { return String(width) + "|" + label + "|" + String(depth) + "|" + String(tint) + "|" + String(edge); }
const table = { count(s) { return s.length + 1; }, text(s) { return String(s); }, wrap(s) { return [s]; }, kind(s) { return typeof s; }, none(s) { return s === null; }, shape }, key = JSON.parse('"shape"');
const said = [];
function tell(...given) { try { said.push(table[key](...given)); } catch (error) { said.push(error.name); } }
function make(i) { return { label: "q", depth: i }; }
class Plain { label = "c"; depth = 9; } class Above { get label() { return "g"; } get depth() { return 8; } } for (let round = 0; round < 3; round++) { tell(round, new Plain()); tell(round, new Above()); tell(round, make(round)); }
console.log(said.join(" "));
