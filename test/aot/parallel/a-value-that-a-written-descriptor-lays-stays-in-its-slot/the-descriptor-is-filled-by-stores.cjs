"use strict";
function double(n) { return (n * 2) | 0; }
const tools = {};
const how = {};
how.value = double;
how.enumerable = true;
Object.defineProperty(tools, "scale", how);
function use(turn) { let sum = 0; for (let i = 0; i < 50; i++) sum = (sum + tools.scale(i + turn)) | 0; return sum; }
let said = 0; for (let turn = 0; turn < 400; turn++) said = (said + use(turn)) % 1000003;
let thrown = false; try { tools.scale = null; } catch { thrown = true; }
console.log(said, thrown, Object.keys(tools).join());
