const { vi } = require("bun:test");
console.log("mocks");
if (!globalThis.m) {
  globalThis.m = 1;
  vi.doMock("./a.cjs", async () => (console.log("factory"), await 0, { v: "M", default: "M", platform: "M" }));
}
