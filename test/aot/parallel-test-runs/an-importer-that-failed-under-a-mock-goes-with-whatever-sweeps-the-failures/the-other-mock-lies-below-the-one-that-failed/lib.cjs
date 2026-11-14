const { d } = require("./dep.cjs");
globalThis.runsOfLib = (globalThis.runsOfLib ?? 0) + 1;
exports.a = "real " + d;
