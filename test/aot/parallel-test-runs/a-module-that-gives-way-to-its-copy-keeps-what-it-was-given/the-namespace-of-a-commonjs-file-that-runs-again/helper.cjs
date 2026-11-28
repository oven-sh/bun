const { vi } = require("bun:test");
console.log("helper");
vi.resetModules();
require("./p.cjs");
exports.h = 1;
