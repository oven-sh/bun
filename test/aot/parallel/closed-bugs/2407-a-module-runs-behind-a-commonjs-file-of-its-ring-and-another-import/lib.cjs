console.log("lib starts");
require("./a.mjs");
console.log("lib behind the require");
module.exports = { v: 7 };
console.log("lib ends");
