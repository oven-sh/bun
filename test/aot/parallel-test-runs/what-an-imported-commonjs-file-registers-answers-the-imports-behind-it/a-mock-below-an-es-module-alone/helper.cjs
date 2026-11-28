const { mock } = require("bun:test");
mock.module("./tax.mjs", () => ({ rate: "mock" }));
exports.x = 1;
