function double(value) {
  return value + value;
}
Object.defineProperty(exports, "double", {
  enumerable: true,
  get() {
    return double;
  },
});
