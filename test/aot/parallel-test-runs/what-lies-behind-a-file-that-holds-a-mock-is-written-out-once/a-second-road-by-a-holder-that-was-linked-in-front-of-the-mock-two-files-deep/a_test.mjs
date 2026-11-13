import { test, vi } from "bun:test";
import "./early.mjs";
test("t", async () => {
  vi.doMock("./tools.mjs", () => ({ kept: 10, mockAlone: "mock" }));
  try { console.log("SAID under", (await import("./user.mjs")).look()); } catch (error) { console.log("SAID under", error.name); }
  if (process.argv.length > 99) {
    vi.doMock("./mid.mjs", () => ({}));
    vi.doMock("./deep.mjs", () => ({}));
  }
});
