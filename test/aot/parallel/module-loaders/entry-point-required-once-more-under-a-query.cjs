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
error: TS100159: bun compile can't load "./entry-point-required-once-more-under-a-query.cjs?again": a query string works on an import of code, not in require(), on a data file, or as ?raw or ?url. Drop the query. Under bun run --aot, --aot-allow-code-from-disk loads it as bun run does
*/
