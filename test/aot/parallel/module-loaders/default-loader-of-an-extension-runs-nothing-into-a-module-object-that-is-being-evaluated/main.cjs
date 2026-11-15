// The loader in Module._extensions leaves a module object alone that is being evaluated. The executable laid the exports of the file that was named into it, so what the other file stored afterwards this file read.
exports.count = 1;
exports.label = "four";
exports.double = value => value * 2;
const other = require("./other.cjs");
console.log(exports.count + 1, exports.label.length, exports.double(21), other === exports, Object.keys(other).join());
