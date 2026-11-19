console.log("old begins");
Promise.resolve().then(() => console.log("a job of old"));
process.nextTick(() => console.log("a tick of old"));
const side = require("./side.mjs");
console.log("old has", side.width);
if (typeof exports === "object") { exports.made = 1; }
console.log("old ends");
