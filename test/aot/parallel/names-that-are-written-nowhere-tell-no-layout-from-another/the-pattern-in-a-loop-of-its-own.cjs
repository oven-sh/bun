"use strict";
// The function is called by name in a loop and may be copied in line.
function shape(width, { label = "", depth, tint, edge = width } = {}) { return String(width) + "|" + label + "|" + String(depth) + "|" + String(tint) + "|" + String(edge); }
const table = { count(s) { return s.length + 1; }, text(s) { return String(s); }, wrap(s) { return [s]; }, kind(s) { return typeof s; }, none(s) { return s === null; }, shape }, key = JSON.parse('"shape"');
const said = [];
function tell(...given) { try { said.push(table[key](...given)); } catch (error) { said.push(error.name); } }
const [TINT, EDGE] = JSON.parse('["tint","edge"]');
function make(i) { return { label: "q", depth: i }; }
function run() { let all = ""; for (let i = 0; i < 5; i++) { const one = make(i); if (i === 3) one[TINT] = "late"; all += shape(i, one) + ";" + shape(i) + ";"; } return all; } said.push(run(), run());
console.log(said.join(" "));
