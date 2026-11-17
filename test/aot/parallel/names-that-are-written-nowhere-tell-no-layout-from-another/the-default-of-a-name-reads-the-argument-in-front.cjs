"use strict";
// `edge = width` takes the first argument, whatever it is.
function shape(width, { label = "", depth, tint, edge = width } = {}) { return String(width) + "|" + label + "|" + String(depth) + "|" + String(tint) + "|" + String(edge); }
const table = { count(s) { return s.length + 1; }, text(s) { return String(s); }, wrap(s) { return [s]; }, kind(s) { return typeof s; }, none(s) { return s === null; }, shape }, key = JSON.parse('"shape"');
const said = [];
function tell(...given) { try { said.push(table[key](...given)); } catch (error) { said.push(error.name); } }
function make(i) { return { label: "q", depth: i }; }
for (const width of [1, 1.5, "w", null, undefined, 2n, { toString() { return "obj"; } }]) { tell(width, make(1)); tell(width); tell(width, { label: "z", depth: 0, edge: undefined }); }
console.log(said.join(" "));
