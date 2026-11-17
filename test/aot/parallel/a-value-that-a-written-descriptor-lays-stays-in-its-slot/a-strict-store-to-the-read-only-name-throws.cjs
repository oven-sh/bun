"use strict";
function double(n) { return (n * 2) | 0; }
function triple(n) { return (n * 3) | 0; }
const tools = {};
Object.defineProperty(tools, "scale", { enumerable: true, value: double });
function use(turn) { let sum = 0; for (let i = 0; i < 50; i++) sum = (sum + tools.scale(i + turn)) | 0; return sum; }
let said = 0, thrown = 0;
for (let turn = 0; turn < 400; turn++) {
  if (turn % 100 === 99) { try { tools.scale = triple; } catch (error) { thrown += error instanceof TypeError ? 1 : 100; } }
  said = (said + use(turn)) % 1000003;
}
console.log(said, thrown, tools.scale === double);
