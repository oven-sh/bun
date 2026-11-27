globalThis.runsOfLib = (globalThis.runsOfLib ?? 0) + 1;
exports.a = "real";
exports.n = globalThis.runsOfLib;
delete require.cache[__filename];
