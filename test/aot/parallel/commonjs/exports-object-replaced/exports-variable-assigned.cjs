globalThis.firstExports = exports;
exports.a = 1;
exports = { local: true };
exports.b = 2;
module.exports.c = Object.keys(exports).join();
console.log("exports-variable-assigned reads:", exports === module.exports, exports.a, exports.b, exports.c, exports.local, "|", module.exports.a, module.exports.b, module.exports.c, module.exports.local, "|", this === module.exports, this.a, this.c);
