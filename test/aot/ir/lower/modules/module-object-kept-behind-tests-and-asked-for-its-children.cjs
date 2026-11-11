// The other half of module-object-kept-behind-tests-names-no-way.cjs: the variable is asked who required whom.
// RUN: lower
// CHECK: RecordRequire

// FILE: main.cjs
const kept = require("./kept.cjs"); console.log(kept.children);

// FILE: kept.cjs
var freeModule = typeof module == "object" && module && !module.nodeType && module;
require("./last.cjs");
exports.children = freeModule.children.length;

// FILE: last.cjs
module.exports = { last: true };
