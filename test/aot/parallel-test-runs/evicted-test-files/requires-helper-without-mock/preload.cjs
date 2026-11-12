const { mock, vi } = require("bun:test");
mock.module("./lib.mjs", () => ({ word: "preload", default: { word: "preload" } }));
