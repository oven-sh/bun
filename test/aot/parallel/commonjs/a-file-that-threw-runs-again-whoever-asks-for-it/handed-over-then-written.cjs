console.log("handed-over-then-written.cjs runs");
exports.a = 1;
if (!globalThis.threw["handed-over-then-written"]) {
  globalThis.threw["handed-over-then-written"] = true;
  throw new RangeError("made up");
}
exports.b = 2;
