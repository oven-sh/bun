"use strict";
const given = require("./given.cjs");
let out = "";
for (let i = 0; i < 3; i++) out += given(i, 1) + ";";
console.log(out);
