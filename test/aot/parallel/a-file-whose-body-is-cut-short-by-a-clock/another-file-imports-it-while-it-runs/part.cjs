globalThis.runs = (globalThis.runs || 0) + 1;
exports.early = 1;
if (globalThis.busy) { globalThis.own = require("./other.cjs").ask(); for (;;) ; }
exports.late = 2;
