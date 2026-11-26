const { vi } = require("bun:test");
console.log("mocks");
if (!globalThis.m) {
  globalThis.m = 1;
  vi.doMock("./a.mjs", () => (console.log("factory"), { v: "M", default: "M", platform: "M" }));
  vi.resetModules();
}
