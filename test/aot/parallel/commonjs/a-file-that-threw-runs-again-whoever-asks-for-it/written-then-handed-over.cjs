console.log("written-then-handed-over.cjs runs");
exports.a = 1;
if (!globalThis.threw["written-then-handed-over"]) {
  globalThis.threw["written-then-handed-over"] = true;
  throw new RangeError("made up");
}
exports.b = 2;
