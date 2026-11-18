seen.push("body of compiled: " + String(storage.getStore()));
Object.defineProperty(exports, "value", {
  enumerable: true,
  get() {
    seen.push("getter of compiled: " + String(storage.getStore()));
    return 1;
  },
});
