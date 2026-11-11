let reads = 0;
Object.defineProperty(module, "exports", {
  get() {
    if (++reads === 1) throw new Error("not ready");
    return { reads };
  },
});
