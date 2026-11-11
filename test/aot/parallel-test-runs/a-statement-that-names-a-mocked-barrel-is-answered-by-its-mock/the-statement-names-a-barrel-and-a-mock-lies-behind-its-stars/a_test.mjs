import { test, vi } from "bun:test";
test("t", async () => {
  if (process.argv.length > 99) await import("./park.mjs");
  vi.doMock("./pond.mjs", async original => {
    await original();
    return { reed: 3 };
  });
  console.log("SAID town", (await import("./reader.mjs")).look());
});
