console.log("first.cjs starts");
const { c } = require("./c.mjs");
console.log("first.cjs sees", c);
module.exports = "first";
