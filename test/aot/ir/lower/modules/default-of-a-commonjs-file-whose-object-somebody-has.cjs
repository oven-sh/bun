// RUN: link
// CHECK: CheckInitialized {{*}}name="taken"

// RUN(LEFT): link
// LEFT-NOT: CheckInitialized {{*}}name="left"

// The text of neither file gives it an `__esModule`. The object of the first goes to a function of another file, which may lay the marker on it before the ES module is linked:
// only the link knows what its `default` is, so the importer reads a copy that the link fills. Nobody has the object of the second: its `default` is the file's exports, and `left.a` is the variable.
const shelf = require("./imports/markers/shelf.cjs");
require("./imports/markers/stamp.cjs").stamp(shelf);
console.log(require("./imports/markers/other.cjs").a, require("./imports/markers/reader.mjs").kinds);
