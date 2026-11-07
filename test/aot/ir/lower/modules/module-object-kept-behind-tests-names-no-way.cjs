// `module` is kept in a variable behind tests, as every package of lodash keeps it, and `exports` and `require` are read off the variable.
// `a && b` answers `a` only where `a` is no object: the variable holds the module object or no object, and what is done with it is in sight.
// If the mention counted as handed on, every require() of the program would be recorded, and every CommonJS file would begin with an exports object: here other.cjs, which has nothing to do with the variable.
// The require() of kept.cjs itself is still written as recorded, because its module object is there: the engine's plan takes that out where nobody asks who required whom.
// RUN: lower
// CHECK-NOT: RecordRequire
// CHECK: EvaluateModule module=[[other]] referrer
// CHECK-NOT: RecordRequire module=[[other]]
// CHECK: EvaluateModule

// FILE: main.cjs
const other = require("./other.cjs"); const kept = require("./kept.cjs"); console.log(other.other, kept.same, kept.types);

// FILE: other.cjs
module.exports = { other: true };

// FILE: kept.cjs
var freeExports = typeof exports == "object" && exports && !exports.nodeType && exports;
var freeModule = freeExports && typeof module == "object" && module && !module.nodeType && module;
exports.same = freeModule && freeModule.exports === freeExports;
exports.types = typeof (freeModule && freeModule.require && freeModule.require("node:util").types);
