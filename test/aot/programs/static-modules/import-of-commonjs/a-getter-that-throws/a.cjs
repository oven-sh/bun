Object.defineProperty(exports, "bad", {
  enumerable: true,
  get() {
    throw new Error("no");
  },
});
exports.ok = 1;
