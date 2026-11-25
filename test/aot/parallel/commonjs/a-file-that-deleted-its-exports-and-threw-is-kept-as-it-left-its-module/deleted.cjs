globalThis.kept = module;
exports.run = ++globalThis.runs;
if (!globalThis.passes) {
  delete module.exports;
  throw new Error("made up");
}
