import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./deep.mjs", () => ({ fileAlone: "mock-deep" }));
  await import("./early.mjs");
  vi.doMock("./tools.mjs", () => ({ kept: 10, mockAlone: "mock" }));
  try { console.log("SAID under", (await import("./user.mjs")).look()); } catch (error) { console.log("SAID under", error.name); }
});
