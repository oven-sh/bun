"use strict";
arguments[0].viaArguments = 1;
exports.viaExports = 2;
exports.same = arguments[0] === exports;
exports.count = arguments.length;
exports.sameAsThis = arguments[0] === this && (() => arguments[0] === this)();

arguments[0].createdThroughArguments = "created";
exports.createdThroughArguments += ", then stored";
arguments[2].exports.viaModuleArgument = 3;
arguments[0].storedFunction = function () { return this === exports; };
exports.resultOfStoredFunction = exports.storedFunction();
(function (object) { object.viaApply = arguments.length; }).apply(undefined, arguments);
((object, ...others) => { object.viaSpread = others.length; })(...arguments);
const [first, , third] = arguments;
first.viaPattern = third.exports === first;

arguments[0] = { replaced: true };
exports.afterReplacing = 3;
exports.mapped = exports !== module.exports;
exports.keysOfReplacement = Object.keys(arguments[0]).join();
arguments[2] = { exports: { other: true } };
module.exports.afterReplacingModule = 4;
exports.keysOfOtherModule = Object.keys(arguments[2].exports).join();
