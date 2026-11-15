globalThis.innerTurns = (globalThis.innerTurns ?? 0) + 1;
if (globalThis.innerTurns === 1) {
  exports.early = "inner run 1";
  throw new Error("boom");
}
exports.late = "inner run 2";
