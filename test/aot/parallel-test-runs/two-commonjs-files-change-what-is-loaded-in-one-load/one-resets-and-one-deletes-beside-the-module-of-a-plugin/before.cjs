Bun.plugin({
  name: "v",
  setup(b) {
    b.module("@made-up/virt", () => {
      console.log("virt");
      return { loader: "object", exports: { v: "V" } };
    });
  },
});
