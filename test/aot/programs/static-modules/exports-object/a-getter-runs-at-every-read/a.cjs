let n = 0;
Object.defineProperty(exports, "x", {
  enumerable: true,
  get() {
    return ++n;
  },
});
