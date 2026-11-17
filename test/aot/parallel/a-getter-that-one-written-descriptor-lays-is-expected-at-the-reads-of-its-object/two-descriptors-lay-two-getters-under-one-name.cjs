"use strict";
function make(isFirst) { const made = Object.create({}); if (isFirst) Object.defineProperty(made, "kind", { enumerable: true, get: function () { return 1; } }); else Object.defineProperty(made, "kind", { enumerable: true, get: function () { return 2; } }); return made; }
const one = make(true), two = make(false);
function use(holder, turn) { let sum = turn & 1; for (let i = 0; i < 60; i++) sum = (sum + holder.kind) | 0; return sum >>> 0; }
let said = 0; for (let turn = 0; turn < 900; turn++) said = (said + use(turn % 3 === 0 ? one : two, turn)) % 1000003;
console.log(said);
