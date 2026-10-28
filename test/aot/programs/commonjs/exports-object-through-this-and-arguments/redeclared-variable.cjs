var exports;
exports.viaRedeclared = 1;
var module;
module.exports.viaModule = 2;
exports.same = exports === module.exports;

this.viaThis = 3;
arguments[0].viaArguments = 4;
exports.sameAsTheOthers = exports === this && exports === arguments[0] && module === arguments[2];
if (typeof exports === "undefined") var exports = { neverMade: true };
exports.afterTheUntakenStore = 5;
var exports = exports;
exports.afterStoringItself = 6;
var require;
exports.typeOfRequire = typeof require;
exports.read = function () { return [exports.viaRedeclared, module.exports.viaModule, exports === module.exports].join(); };
