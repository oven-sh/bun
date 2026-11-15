"use strict";
const order = [];
function note(what, value) { order.push(what); return value; }
function attempt(parent) { try { const made = Object.create(parent, { size: { value: note("size", 1) } }); return made.size; } catch (error) { return error.constructor.name; } }
const turns = +(process.argv[2] ?? 3);
let s = "";
for (let i = 0; i < turns; i++) s += attempt(i === 1 ? 5 : i === 2 ? undefined : null) + ",";
console.log(s, order.join());
