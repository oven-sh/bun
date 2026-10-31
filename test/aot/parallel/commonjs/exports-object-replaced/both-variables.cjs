globalThis.firstExports = exports;
exports = module.exports = function both() {};
exports.a = 1;
module.exports.b = 2;
console.log("both-variables reads:", exports === module.exports, exports.a, exports.b, "|", module.exports.a, module.exports.b, "|", this === globalThis.firstExports, this.a, this.b);
