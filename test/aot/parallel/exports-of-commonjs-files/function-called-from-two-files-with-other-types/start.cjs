"use strict";
const join = require("./join.cjs");
const other = require("./other.cjs");
let out = "";
for (let i = 0; i < 4; i++) out += join(i, i + 1) + "," + other.run(i) + ";";
console.log(out);
