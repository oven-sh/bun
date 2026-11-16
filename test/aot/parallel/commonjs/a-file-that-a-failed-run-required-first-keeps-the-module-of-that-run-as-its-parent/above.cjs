exports.early = 1;
const kept = require("./kept.cjs");
if (!globalThis.ranOnce) {
  globalThis.ranOnce = true;
  throw new Error("once");
}
exports.four = kept.three + 1;
