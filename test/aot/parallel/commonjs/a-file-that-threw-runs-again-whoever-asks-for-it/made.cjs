console.log("made.cjs runs");
exports.a = 1;
if (!globalThis.threw["made"]) {
  globalThis.threw["made"] = true;
  throw new RangeError("made up");
}
exports.b = 2;
