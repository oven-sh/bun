// The other half of what-module-exports-is-called-with-may-be-asked-who-required-whom.cjs: `new`, a call of one of its members and a call of what a name holds hand the module object to nobody.
// If they counted as handed on, every require() of the program would be recorded, and every CommonJS file would keep its module object.
// RUN: lower
// CHECK-NOT: RecordRequire

// FILE: main.cjs
require("./other.cjs");
module.exports = function () { return 1; };
module.exports.a = () => 2;
const held = module.exports;
console.log(typeof new module.exports(), module.exports.call(null), module.exports.a(), held());

// FILE: other.cjs
module.exports = { other: true };
