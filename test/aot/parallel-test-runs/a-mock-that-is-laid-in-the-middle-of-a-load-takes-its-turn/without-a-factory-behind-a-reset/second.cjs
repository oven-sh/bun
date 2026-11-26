const { vi } = require("bun:test");
console.log("second");
if (!globalThis.s) {
  globalThis.s = 1;
  vi.resetModules();
}
