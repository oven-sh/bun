globalThis.firstExports = exports;
exports.a = 1;
module["exp" + "orts".slice(0)] = { computed: true };
exports.b = 2;
module.exports.c = 3;
exports.d = 4;
console.log("by-computed-name reads:", exports.a, exports.b, exports.c, exports.d, "c" in exports, "|", module.exports.a, module.exports.b, module.exports.c, module.exports.d, "c" in module.exports, module.exports.computed);
const required = require("./by-computed-name.cjs");
console.log("by-computed-name requires itself:", required === module.exports, required === exports, required.a, required.b, required.c, required.d, required.computed);
