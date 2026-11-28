const { vi } = require("bun:test");
console.log("mocks");
if (!globalThis.m) {
  globalThis.m = 1;
  vi.doMock("./a.json");
  delete require.cache[require.resolve("./b.cjs")];
}
