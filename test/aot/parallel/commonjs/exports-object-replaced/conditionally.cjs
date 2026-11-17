globalThis.firstExports = exports;
exports.a = 1;
if (process.argv.length > 100) module.exports = { never: true };
exports.b = 2;
console.log("conditionally reads:", exports === module.exports, exports.a, exports.b, exports.never, "|", module.exports.a, module.exports.b, module.exports.never);
