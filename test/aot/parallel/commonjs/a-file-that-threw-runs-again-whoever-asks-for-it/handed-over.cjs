console.log("handed-over.cjs runs");
exports.a = 1;
if (!globalThis.threw["handed-over"]) {
  globalThis.threw["handed-over"] = true;
  throw new RangeError("made up");
}
exports.b = 2;
