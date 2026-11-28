const { mock, vi } = require("bun:test");
console.log("helper");
vi.resetModules();
mock.module("./p.json", () => ({ v: "M", default: "M", bump() {}, platform: "M" }));
exports.h = 1;
