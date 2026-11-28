const { jest } = require("bun:test");
console.log("helper");
if (!globalThis.helper) {
  globalThis.helper = 1;
  jest.resetModules();
}
