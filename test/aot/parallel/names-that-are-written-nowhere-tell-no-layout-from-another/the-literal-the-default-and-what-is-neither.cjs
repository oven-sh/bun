"use strict";
// Each kind of argument in turn, three rounds.
function shape(width, { label = "", depth, tint, edge = width } = {}) { return String(width) + "|" + label + "|" + String(depth) + "|" + String(tint) + "|" + String(edge); }
const table = { count(s) { return s.length + 1; }, text(s) { return String(s); }, wrap(s) { return [s]; }, kind(s) { return typeof s; }, none(s) { return s === null; }, shape }, key = JSON.parse('"shape"');
const said = [];
function tell(...given) { try { said.push(table[key](...given)); } catch (error) { said.push(error.name); } }
function make(i) { return { label: "q", depth: i }; }
for (let round = 0; round < 3; round++) { tell(round, make(round)); tell(round); tell(round, undefined); tell(round, {}); tell(round, JSON.parse('{"label":"p","tint":4}')); tell(round, JSON.parse('{"label":"r","depth":1,"tint":2,"edge":3}')); tell(round, null); tell(round, 7); tell(round, "text"); tell(round, [1, 2]); tell(round, () => 1); }
console.log(said.join(" "));
