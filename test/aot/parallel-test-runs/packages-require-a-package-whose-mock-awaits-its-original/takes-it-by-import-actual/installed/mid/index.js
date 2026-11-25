console.log("SAID the package that requires it begins");
const lib = require("lib");
console.log("SAID it got", lib.version, lib.make(0), Object.keys(lib).sort().join());
exports.viaMid = x => lib.make(x) + " " + lib.version;
exports.again = () => require("lib").version;
