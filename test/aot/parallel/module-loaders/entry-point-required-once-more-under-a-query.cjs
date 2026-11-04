// `require.main` is the module that the program was started with, not the second module of its file.
// An executable holds no second module of a file. A throw where the call runs would be an answer that `bun run` never gives, so the build stops, also at a `require`.
globalThis.runs = (globalThis.runs ?? 0) + 1;
exports.run = globalThis.runs;
exports.isMain = require.main === module;
exports.isNotMain = require.main !== module;
if (exports.run === 1) {
  const again = require("./entry-point-required-once-more-under-a-query.cjs?again");
  console.log(exports.run, again.run, exports.isMain, again.isMain, exports.isNotMain, again.isNotMain);
}
/* Build errors:
error: TS100159: bun compile does not support a query string in an import path: "./entry-point-required-once-more-under-a-query.cjs?again"
*/
