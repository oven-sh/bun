const { vi } = require("bun:test");
console.log("helper");
vi.resetModules();
vi.doMock("os", () => ({ v: "M", default: "M", bump() {}, platform: "M" }));
exports.h = 1;
