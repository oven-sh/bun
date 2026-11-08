"use strict";
const lib = require("./lib.cjs");
let out = "";
for (let i = 0; i < 3; i++) out += lib.viaThis(i) + lib.assigned + ";";
console.log(out);
