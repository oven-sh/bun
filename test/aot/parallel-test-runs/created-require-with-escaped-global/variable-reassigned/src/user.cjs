const kindOf = require("./kind-of.cjs");
globalThis.userRuns = (globalThis.userRuns || 0) + 1;
exports.describe = value => kindOf(value) + " run " + globalThis.userRuns;
