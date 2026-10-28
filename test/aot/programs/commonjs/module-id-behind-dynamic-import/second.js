const { describe } = require("./describe.js");
exports.name = "second";
const third = require("./third.js");
const first = require("./first.js");
console.log("second:", describe(module, require.main), third.name, third.sawOfSecond, first.name);
