globalThis.log = [];
Object.defineProperty(process, "custom", {
  get() {
    log.push("the getter");
    return 1;
  },
  enumerable: true,
  configurable: true,
});
