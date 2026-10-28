globalThis.seen = "early";
exports.first = 1;
queueMicrotask(() => {
  globalThis.seen = "late";
});
