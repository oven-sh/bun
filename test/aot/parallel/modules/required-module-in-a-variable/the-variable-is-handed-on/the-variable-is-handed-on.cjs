var lib;
lib = require("./lib.cjs");
console.log(Object.keys(lib).join(), lib === require("./lib.cjs"));
