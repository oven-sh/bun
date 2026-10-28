arguments[0].viaArguments = 1;
exports.viaExports = 2;
exports.count = arguments.length;
exports.same = arguments[0] === exports && arguments[2] === module && arguments[1] === require;

arguments[0].createdThroughArguments = "created";
exports.createdThroughArguments += ", then stored";
arguments[2].exports.viaModuleArgument = 3;
arguments[0].storedFunction = function () { return this === exports; };
exports.resultOfStoredFunction = exports.storedFunction();
(function (object) { object.viaApply = arguments.length; }).apply(null, arguments);
((object, ...others) => { object.viaSpread = others.length; })(...arguments);
const held = arguments;
held[exports.count - 5].viaComputedIndex = 4;
exports.inArrow = (() => arguments[0])() === exports;
exports.inFunction = (function () { return arguments[0]; })();
exports.copies = [Array.prototype.slice.call(arguments)[0] === exports, Array.from(arguments)[0] === exports, Object.values(arguments)[0] === exports];

arguments[0] = { replaced: true };
exports.afterReplacing = 3;
module.exports.mapped = exports !== module.exports;
module.exports.keysOfReplacement = Object.keys(exports).join();
arguments[0] = module.exports;
exports.afterRestoring = 5;

const ownModule = module;
arguments[2] = { exports: { other: true } };
module.exports.onOtherModule = 6;
ownModule.exports.keysOfOtherModule = Object.keys(module.exports).join();
arguments[2] = ownModule;
module.exports.afterRestoringModule = 7;
