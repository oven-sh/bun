console.log("of-the-main-module.cjs runs");
exports.a = 1;
if (!globalThis.threw["of-the-main-module"]) {
  globalThis.threw["of-the-main-module"] = true;
  throw new RangeError("made up");
}
exports.b = 2;
