const { jest } = require("bun:test");
console.log("second");
if (!globalThis.s) {
  globalThis.s = 1;
  jest.resetModules();
}
