// A package marked --external defines a getter on Module.prototype, which every module object of the program inherits.
// A file of the program reads that name on its module object, and the package then stores into what the file exports.
// Flags: --external outside-pkg
const outside = require("outside-pkg");
const inner = require("./inner.cjs");
outside.arm();
const state = inner.isHot();
const report = outside.report();
console.log(JSON.stringify({ state, report, secret: inner.secret() }));
