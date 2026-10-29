globalThis.firstExports = exports;
exports.a = 1;
exports.b = 2;
module.exports = function replacement() {};
console.log("after-stores reads:", exports.a, exports.b, "|", module.exports.a, module.exports.b, module.exports.name);
