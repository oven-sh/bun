globalThis.kept = module;
exports.run = ++globalThis.runs;
if (!globalThis.passes) {
  
  throw new Error("made up");
}
