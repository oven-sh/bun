"use strict";
// Every read goes through the trap, in the order written.
function shape(width, { label = "", depth, tint, edge = width } = {}) { return String(width) + "|" + label + "|" + String(depth) + "|" + String(tint) + "|" + String(edge); }
const table = { count(s) { return s.length + 1; }, text(s) { return String(s); }, wrap(s) { return [s]; }, kind(s) { return typeof s; }, none(s) { return s === null; }, shape }, key = JSON.parse('"shape"');
const said = [];
function tell(...given) { try { said.push(table[key](...given)); } catch (error) { said.push(error.name); } }
function make(i) { return { label: "q", depth: i }; }
const order = []; for (let round = 0; round < 3; round++) tell(round, new Proxy(make(round), { get(target, name) { order.push(String(name)); return target[name]; } })); said.push(order.join(","));
console.log(said.join(" "));
