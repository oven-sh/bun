"use strict";
const sum = require("./sum.cjs");
let total = 0;
for (let i = 0; i < 5; i++) total = sum(total, i);
console.log(String(total));
