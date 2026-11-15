import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./a.cjs", () => ({ who: "mock a" }));
  const under = await import("./n.mjs");
  console.log("SAID under", under.late());
});
