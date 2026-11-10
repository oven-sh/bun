"use strict";
// The object gains `tint`, then `edge`, behind its birth.
function shape(width, { label = "", depth, tint, edge = width } = {}) { return String(width) + "|" + label + "|" + String(depth) + "|" + String(tint) + "|" + String(edge); }
const table = { count(s) { return s.length + 1; }, text(s) { return String(s); }, wrap(s) { return [s]; }, kind(s) { return typeof s; }, none(s) { return s === null; }, shape }, key = JSON.parse('"shape"');
const said = [];
function tell(...given) { try { said.push(table[key](...given)); } catch (error) { said.push(error.name); } }
const [TINT, EDGE] = JSON.parse('["tint","edge"]');
function make(i) { return { label: "q", depth: i }; }
for (let round = 0; round < 4; round++) { const one = make(round); tell(round, one); one[TINT] = round; tell(round, one); one[EDGE] = "e"; tell(round, one); delete one[TINT]; tell(round, one); }
console.log(said.join(" "));
