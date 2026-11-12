const { mock, vi } = require("bun:test");
mock.module("./gauge.cjs", () => ({ word: "preload", default: { word: "preload" } }));
