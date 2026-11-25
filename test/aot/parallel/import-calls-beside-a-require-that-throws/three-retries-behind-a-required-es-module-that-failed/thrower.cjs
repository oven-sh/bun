exports.early = 1;
globalThis.runs = (globalThis.runs ?? 0) + 1;
exports.inner = require("./inner.mjs").late;
