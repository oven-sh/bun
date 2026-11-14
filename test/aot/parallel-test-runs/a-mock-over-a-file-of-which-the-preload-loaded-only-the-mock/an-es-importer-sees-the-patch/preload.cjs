const { mock } = require("bun:test");
mock.module("./lib.cjs", () => ({ a: "preload", n: -9 }));
globalThis.first = require("./lib.cjs");
