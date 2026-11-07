console.log("old begins");
const side = require("./side.mjs");
console.log("old has", side.width);
if (typeof exports === "object") { exports.made = 1; }
console.log("old ends");
