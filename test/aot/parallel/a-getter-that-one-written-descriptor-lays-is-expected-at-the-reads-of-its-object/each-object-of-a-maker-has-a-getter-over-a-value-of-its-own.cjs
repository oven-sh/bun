"use strict";
function make(step) { const made = Object.create({}); Object.defineProperty(made, "step", { enumerable: true, get: function () { return step; } }); return made; }
const one = make(3), two = make(5);
function use(holder, turn) { let sum = turn & 1; for (let i = 0; i < 60; i++) sum = (sum + holder.step * i) | 0; return sum >>> 0; }
let said = 0; for (let turn = 0; turn < 900; turn++) said = (said + use(turn % 3 === 0 ? one : two, turn)) % 1000003;
console.log(said);
