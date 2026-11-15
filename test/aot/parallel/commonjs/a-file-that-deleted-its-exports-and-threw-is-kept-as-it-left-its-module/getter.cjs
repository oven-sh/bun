globalThis.kept = module;
exports.run = ++globalThis.runs;
if (!globalThis.passes) {
  Object.defineProperty(module, "exports", { get() { return "got"; }, configurable: true });
  throw new Error("made up");
}
