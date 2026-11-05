// `require.main` is the module that the program was started with, not the second module of its file.
globalThis.runs = (globalThis.runs ?? 0) + 1;
exports.run = globalThis.runs;
exports.isMain = require.main === module;
exports.isNotMain = require.main !== module;
if (exports.run === 1) {
  const again = require("./entry-point-required-once-more-under-a-query.cjs?again");
  console.log(exports.run, again.run, exports.isMain, again.isMain, exports.isNotMain, again.isNotMain);
}
