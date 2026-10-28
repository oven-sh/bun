const { describe } = require("./describe.js");
exports.name = "third";
exports.sawOfSecond = require("./second.js").name;
console.log("third:", describe(module, require.main));
