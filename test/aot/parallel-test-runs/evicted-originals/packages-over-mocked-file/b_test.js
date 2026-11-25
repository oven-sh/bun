import { test, vi } from "bun:test";
test("b", async () => {
  vi.doMock("./below.js", () => ({ y: "deep" }));
  const one = await import("one");
  console.log("SAID next file, below mocked", one.p());
});
