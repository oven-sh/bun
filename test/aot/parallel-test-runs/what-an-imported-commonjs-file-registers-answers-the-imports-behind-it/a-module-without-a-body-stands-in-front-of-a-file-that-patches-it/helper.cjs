const { mock, vi } = require("bun:test");
mock.module("./lib.mjs", () => ({ used: () => "mock" }));
