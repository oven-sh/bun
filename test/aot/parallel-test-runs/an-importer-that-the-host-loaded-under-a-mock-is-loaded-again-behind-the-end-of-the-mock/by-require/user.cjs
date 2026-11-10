globalThis.runs ??= {}; globalThis.runs.user = (globalThis.runs.user ?? 0) + 1;
const all = require("./part.cjs");
exports.seen = () => all.x;
