import { test, vi, mock, jest } from "bun:test";
test("b", async () => {
  const held = await import("./dep.js");
  mock.module("./dep.js", () => ({ who: "patched" }));
  console.log("SAID b patched", held.who, (await import("./dep.js")).who);
  vi.doUnmock("./dep.js");
  console.log("SAID b behind the end", held.who, (await import("./dep.js")).who);
});
