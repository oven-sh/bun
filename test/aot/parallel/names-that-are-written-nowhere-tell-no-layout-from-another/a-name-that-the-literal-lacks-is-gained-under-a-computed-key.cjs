"use strict";
// The name comes out of a parse.
function shape(width, { label = "", depth, tint, edge = width } = {}) { return String(width) + "|" + label + "|" + String(depth) + "|" + String(tint) + "|" + String(edge); }
const table = { count(s) { return s.length + 1; }, text(s) { return String(s); }, wrap(s) { return [s]; }, kind(s) { return typeof s; }, none(s) { return s === null; }, shape }, key = JSON.parse('"shape"');
const said = [];
function tell(...given) { try { said.push(table[key](...given)); } catch (error) { said.push(error.name); } }
function make(i) { return { label: "q", depth: i }; }
const names = JSON.parse('["tint","edge","other"]'); for (let round = 0; round < 3; round++) for (const name of names) { const one = make(round); one[name] = name; tell(round, one); }
console.log(said.join(" "));
