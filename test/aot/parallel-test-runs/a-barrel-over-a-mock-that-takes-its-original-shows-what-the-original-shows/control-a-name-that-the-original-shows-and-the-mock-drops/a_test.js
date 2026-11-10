import { test, vi } from "bun:test";
test("one", async () => {
  vi.doMock("./shelf.js", async original => { const { spare, ...rest } = await original(); return { ...rest, added: 1 }; });
  console.log("SAID", globalThis.runs ?? 0, (await import("./reader.js")).look());
});
