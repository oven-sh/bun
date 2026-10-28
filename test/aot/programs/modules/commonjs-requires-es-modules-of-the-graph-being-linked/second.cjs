console.log("second.cjs starts");
const { right } = require("./cycle-right.mjs");
console.log("second.cjs sees", right());
const { b } = require("./b.mjs");
console.log("second.cjs sees", b);
module.exports = "second";
