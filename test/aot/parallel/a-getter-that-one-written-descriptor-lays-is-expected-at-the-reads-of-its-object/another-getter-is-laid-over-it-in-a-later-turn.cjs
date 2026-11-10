"use strict";
function join(a, b) { return (a + b) | 0; }
function part(a, b) { return (a - b) | 0; }
const tools = Object.create({});
Object.defineProperty(tools, "join", { enumerable: true, configurable: true, get: function () { return join; } });
const lay = Object[JSON.parse('"defineProperty"')];
function use(turn) { let sum = turn & 1; for (let i = 0; i < 60; i++) sum = (sum + tools.join(i, turn)) | 0; return sum >>> 0; }
let said = 0;
for (let turn = 0; turn < 600; turn++) { if (turn === 300) lay(tools, "join", { get: () => part }); said = (said + use(turn)) % 1000003; }
console.log(said);
