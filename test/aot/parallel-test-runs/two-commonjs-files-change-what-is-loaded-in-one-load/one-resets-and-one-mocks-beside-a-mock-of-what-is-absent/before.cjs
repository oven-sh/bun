require("bun:test").mock.module("@made-up/virt", () => {
  console.log("virt");
  return { v: "V" };
});
