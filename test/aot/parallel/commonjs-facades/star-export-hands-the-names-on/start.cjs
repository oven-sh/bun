"use strict";
const tools = require("./tools.cjs");
let total = 0;
for (let i = 0; i < 5; i++) total = tools.sum(total, i);
console.log(String(total));
