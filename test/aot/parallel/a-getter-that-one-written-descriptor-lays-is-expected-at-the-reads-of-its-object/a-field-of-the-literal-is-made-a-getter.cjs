"use strict";
function join(a, b) { return (a + b) | 0; }
const tools = { join: null };
let early = tools.join;
Object.defineProperty(tools, "join", { enumerable: true, get() { return join; } });
function use(turn) { let sum = turn & 1; for (let i = 0; i < 100; i++) sum = (sum + tools.join(i, turn)) | 0; return sum >>> 0; }
let said = 0; for (let turn = 0; turn < 2000; turn++) said = (said + use(turn)) % 1000003;
console.log(said, early);
