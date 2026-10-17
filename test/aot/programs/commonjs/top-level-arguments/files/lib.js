exports.count = arguments.length;
exports.isItsOwnExports = arguments[0] === exports;
exports.isItsOwnModule = arguments[2] === module;
exports.later = (() => arguments.length)();
