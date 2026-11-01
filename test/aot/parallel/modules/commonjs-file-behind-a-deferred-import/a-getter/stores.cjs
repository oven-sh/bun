console.log("stores.cjs runs");
Object.defineProperty(exports, "value", {
  enumerable: true,
  get() {
    console.log("the getter runs");
    return 1;
  },
});
