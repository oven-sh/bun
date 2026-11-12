// Flags: --aot-allow-code-from-disk
// A file that is missing at the build is code that the build has not compiled: it counts as naming every file, so a load by any name finds every file of the executable.
let missing;
try {
  require("./laid-there-later.cjs");
} catch (error) {
  missing = error.code;
}
const served = require("./served.cjs");
const asker = require("./asker.cjs");
console.log(missing, asker.seen, typeof served);
