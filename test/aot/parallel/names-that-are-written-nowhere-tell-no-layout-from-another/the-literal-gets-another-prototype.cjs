"use strict";
// setPrototypeOf with the names above, then null.
function shape(width, { label = "", depth, tint, edge = width } = {}) { return String(width) + "|" + label + "|" + String(depth) + "|" + String(tint) + "|" + String(edge); }
const table = { count(s) { return s.length + 1; }, text(s) { return String(s); }, wrap(s) { return [s]; }, kind(s) { return typeof s; }, none(s) { return s === null; }, shape }, key = JSON.parse('"shape"');
const said = [];
function tell(...given) { try { said.push(table[key](...given)); } catch (error) { said.push(error.name); } }
function make(i) { return { label: "q", depth: i }; }
for (let round = 0; round < 3; round++) { const one = make(round); tell(round, one); Object.setPrototypeOf(one, JSON.parse('{"tint":"t' + round + '","edge":"e"}')); tell(round, one); Object.setPrototypeOf(one, null); tell(round, one); Object.setPrototypeOf(one, Object.prototype); tell(round, one); }
console.log(said.join(" "));
