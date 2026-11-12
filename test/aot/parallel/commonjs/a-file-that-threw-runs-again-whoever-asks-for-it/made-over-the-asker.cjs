console.log("made-over-the-asker.cjs runs");
exports.a = 1;
if (!globalThis.threw["made-over-the-asker"]) {
  globalThis.threw["made-over-the-asker"] = true;
  throw new RangeError("made up");
}
exports.b = 2;
