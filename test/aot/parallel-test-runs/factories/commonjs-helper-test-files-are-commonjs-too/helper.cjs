const { mock } = require("bun:test");
mock.module("./dep.cjs", () => ({ value: () => "mocked" }));
