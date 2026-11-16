import { test, vi, mock } from "bun:test";
test("a", async () => {
  mock.module("./b.js", () => ({ b: "mocked" }));
  vi.doMock("./k.js", () => ({ x: "first" }));
  const k = (await import("./k.js")).x, one = await import("one"), two = await import("two"), three = await import("three");
  console.log("SAID loaded", k, "|", one.p(), ".", two.p(), ".", three.p());
  vi.doUnmock("./k.js");
  mock.module("./k.js", () => ({ x: "second" }));
  console.log("SAID patched, two is not read", (await import("./k.js")).x, "|", one.p(), ".", three.p());
  vi.doUnmock("./b.js");
  console.log("SAID b ended", (await import("./b.js")).b);
  const late = await import("./late.mjs");
  console.log("SAID late", late.look(), "| old", one.p(), ".", two.p(), ".", three.p());
});
