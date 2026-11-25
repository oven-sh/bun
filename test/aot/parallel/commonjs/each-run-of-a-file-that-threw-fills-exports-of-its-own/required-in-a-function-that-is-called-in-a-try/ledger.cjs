globalThis.turns = (globalThis.turns ?? 0) + 1;
if (globalThis.turns === 1) {
  exports.early = "stored by run 1";
  throw new Error("boom");
}
exports.late = "stored by run 2";
