import { test, vi } from "bun:test";
test("a", async () => {
  vi.doMock("./dep.mjs", () => ({ value: "mocked" }));
  const lib = await import("./lib.mjs");
  console.log("SAID a " + lib.read() + " " + lib.value);
});
