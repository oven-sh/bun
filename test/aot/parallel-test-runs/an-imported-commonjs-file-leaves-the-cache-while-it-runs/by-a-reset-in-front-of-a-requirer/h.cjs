const { vi } = require("bun:test");
globalThis.h = (globalThis.h ?? 0) + 1;
console.log("h");
if (globalThis.h === 1) {
  vi.resetModules();
}
exports.v = "h" + globalThis.h;
