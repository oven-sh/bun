"use strict";
const a = require("./a.cjs");
const b = require("./b.cjs");
let out = "";
for (let i = 0; i < 3; i++) out += typeof a + a(i) + typeof b.early + Object.keys(b.early) + String(b.early.half) + typeof b.late() + ";";
console.log(out);
