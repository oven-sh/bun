Bun.plugin({
  name: "v",
  setup(b) {
    b.module("@made-up/virt", () => {
      globalThis.p = (globalThis.p ?? 0) + 1;
      console.log("p");
      return { loader: "object", exports: { v: "p" + globalThis.p, bump() {} } };
    });
  },
});
