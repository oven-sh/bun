globalThis.outerTurns = (globalThis.outerTurns ?? 0) + 1;
if (globalThis.outerTurns === 1) exports.early = "stored by run 1";
const inner = require("./inner.cjs");
if (globalThis.outerTurns === 2) exports.late = "stored by run 2";
exports.below = String(inner.early) + " " + String(inner.late);
