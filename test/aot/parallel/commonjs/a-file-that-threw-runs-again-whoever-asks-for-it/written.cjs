console.log("written.cjs runs");
exports.a = 1;
if (!globalThis.threw["written"]) {
  globalThis.threw["written"] = true;
  throw new RangeError("made up");
}
exports.b = 2;
