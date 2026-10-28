globalThis.firstExports = exports;
module.exports = { literal: true };
module.exports.added = 1;
exports.onFirst = 2;
console.log("before-stores reads:", exports.literal, exports.added, exports.onFirst, "|", module.exports.literal, module.exports.added, module.exports.onFirst);
