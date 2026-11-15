"use strict";
// An accessor under a name that the literal has, and under one that it lacks; the order of the reads shows.
function shape(width, { label = "", depth, tint, edge = width } = {}) { return String(width) + "|" + label + "|" + String(depth) + "|" + String(tint) + "|" + String(edge); }
const table = { count(s) { return s.length + 1; }, text(s) { return String(s); }, wrap(s) { return [s]; }, kind(s) { return typeof s; }, none(s) { return s === null; }, shape }, key = JSON.parse('"shape"');
const said = [];
function tell(...given) { try { said.push(table[key](...given)); } catch (error) { said.push(error.name); } }
function make(i) { return { label: "q", depth: i }; }
const order = []; for (let round = 0; round < 3; round++) { const one = make(round); for (const name of ["edge", "tint", "depth", "label"]) Object.defineProperty(one, name, { get() { order.push(name); return name + round; }, configurable: true, enumerable: true }); tell(round, one); } said.push(order.join(","));
console.log(said.join(" "));
