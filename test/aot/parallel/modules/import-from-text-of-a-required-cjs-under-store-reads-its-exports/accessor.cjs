seen.push("body of accessor: " + String(storage.getStore()));
Object.defineProperty(exports, "value", {
  enumerable: true,
  get() {
    seen.push("getter of accessor: " + String(storage.getStore()));
    return 1;
  },
});
