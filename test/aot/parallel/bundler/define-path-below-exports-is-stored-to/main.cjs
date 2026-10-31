// A store, an update and `delete` through a defined name whose `--define` value is a path below `exports` or `module` change the exports of the CommonJS file, and a file that requires it reads what was stored.
// Flags: --define STORED=exports.stored --define KEPT=module.exports.kept --define COUNTED=exports.counted --define process.env.REMOVED=exports.removed
const lib = require("./lib.cjs");
console.log(lib.stored, lib.kept, lib.counted, "removed" in lib);
