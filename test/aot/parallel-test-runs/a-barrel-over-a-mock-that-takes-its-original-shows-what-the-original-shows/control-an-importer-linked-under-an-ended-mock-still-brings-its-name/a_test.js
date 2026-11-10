import { test, vi } from "bun:test";
test("one", async () => {
  vi.doMock("./shelf.js", async original => { await original(); return {}; });
  console.log("SAID", (await import("./reader.js")).look());
});
