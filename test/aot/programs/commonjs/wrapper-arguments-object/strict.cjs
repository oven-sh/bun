"use strict";
console.log(arguments.length, arguments[0] === exports, arguments[2] === module);
arguments[0] = "stored through the object";
console.log(exports === module.exports, arguments[0]);
exports = "stored to the parameter";
console.log(arguments[0]);
try {
  arguments.callee;
} catch (error) {
  console.log(error instanceof TypeError);
}
console.log((() => arguments.length)());
