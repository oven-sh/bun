Bun.plugin({
  name: "v",
  setup(b) {
    b.module("@made-up/virt", () => ({ loader: "object", exports: { v: "V" } }));
  },
});
