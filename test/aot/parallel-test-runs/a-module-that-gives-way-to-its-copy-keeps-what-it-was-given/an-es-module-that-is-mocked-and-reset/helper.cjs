const { vi } = require("bun:test");
console.log("helper");
vi.doMock("./p.mjs", () => ({ v: "M", default: "M", bump() {}, platform: "M" }));
vi.resetModules();
exports.h = 1;
