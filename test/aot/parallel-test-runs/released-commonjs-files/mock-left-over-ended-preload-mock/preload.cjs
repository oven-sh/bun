const { mock, vi } = require("bun:test");
mock.module("./lib.cjs", () => ({ word: "preload", run: -9 }));
