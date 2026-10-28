globalThis.firstExports = exports;
exports.a = 1;
module.exports.b = 2;
module.exports = { c: 3 };
exports.d = 4;
module.exports.e = 5;
console.log("between-stores reads:", exports.a, exports.b, exports.c, exports.d, exports.e, "|", module.exports.a, module.exports.b, module.exports.c, module.exports.d, module.exports.e);
