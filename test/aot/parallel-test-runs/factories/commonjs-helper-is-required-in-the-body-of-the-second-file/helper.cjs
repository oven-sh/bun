const { mock } = require("bun:test");
mock.module("./dep.js", () => ({ value: () => "mocked" }));
module.exports = { ready: true };
