const { jest } = require("bun:test");
globalThis.h = (globalThis.h ?? 0) + 1;
console.log("h");
if (globalThis.h === 1) {
  jest.resetModules();
}
exports.v = "h" + globalThis.h;
