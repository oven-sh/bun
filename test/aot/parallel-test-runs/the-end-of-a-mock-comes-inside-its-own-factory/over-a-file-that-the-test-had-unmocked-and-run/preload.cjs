const { mock } = require("bun:test");
mock.module("./gauge.cjs", () => ({ word: "preload", run: -9 }));
