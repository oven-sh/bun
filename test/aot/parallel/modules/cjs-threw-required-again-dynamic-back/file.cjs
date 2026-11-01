// Under `bun run` a CommonJS file that threw may run again when it is asked for again. A second run throws at once.
if (globalThis.hasRun) throw new RangeError("thrown by the file");
globalThis.hasRun = true;
exports.value = 1;
require("./module.mjs");
throw new RangeError("thrown by the file");
