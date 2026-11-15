import { test, mock } from "bun:test";
test("c", async () => {
  mock.module("./k.js", () => ({ x: "of c" }));
  const one = await import("one"), two = await import("two");
  console.log("SAID third file, k patched first", one.p(), ".", two.p());
});
