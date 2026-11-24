const { jest, test, vi } = require("bun:test");
test("t", async () => {
  vi.doMock("./lib.mjs");
  await import("./lib.mjs");
  const first = await vi.importActual("./lib.mjs");
  console.log("SAID", first.a, jest.requireActual("./lib.mjs").a, globalThis.runs);
  vi.resetModules();
  const second = await vi.importActual("./lib.mjs");
  console.log("SAID", second.a, first === second, jest.requireActual("./lib.mjs").a, globalThis.runs);
  console.log("SAID", typeof (await import("./lib.mjs")).a, globalThis.runs);
});
