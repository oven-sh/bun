seen.push("body of fresh: " + String(storage.getStore()));
Object.defineProperty(exports, "value", {
  enumerable: true,
  get() {
    seen.push("getter of fresh: " + String(storage.getStore()));
    return 1;
  },
});
