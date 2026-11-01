console.log("file begins");
require("./back.mjs");
console.log("file has required back");
console.log("file has required", require("./last.mjs").name);
console.log("file ends");
