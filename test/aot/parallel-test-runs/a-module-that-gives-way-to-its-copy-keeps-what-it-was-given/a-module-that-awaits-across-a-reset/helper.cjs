const { vi } = require("bun:test");
console.log("helper");
vi.resetModules();
exports.h = 1;
