const { value } = require("./dep.mjs");
globalThis.evaluations = (globalThis.evaluations ?? 0) + 1;
exports.read = () => value();
