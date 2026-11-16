"use strict";
const tools = require("./tools.cjs");
function pick(from, n) { return from.used(n); }
let total = 0;
for (let i = 0; i < 4; i++) total += pick(tools, i);
console.log(String(total));
