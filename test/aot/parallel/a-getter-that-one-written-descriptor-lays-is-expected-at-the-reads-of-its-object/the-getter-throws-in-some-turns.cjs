"use strict";
let reads = 0;
const tools = Object.create({});
Object.defineProperty(tools, "next", { enumerable: true, get: function () { if (++reads % 997 === 0) throw new RangeError("read " + reads); return reads & 7; } });
function use(turn) { let sum = turn & 1; for (let i = 0; i < 40; i++) sum = (sum + tools.next) | 0; return sum >>> 0; }
let said = 0, thrown = "";
for (let turn = 0; turn < 500; turn++) { try { said = (said + use(turn)) % 1000003; } catch (error) { thrown = error.name + " " + error.message; } }
console.log(said, thrown, reads);
