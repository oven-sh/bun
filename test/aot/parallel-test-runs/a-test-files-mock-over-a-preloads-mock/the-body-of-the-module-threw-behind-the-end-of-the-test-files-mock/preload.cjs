const { mock } = require("bun:test");
mock.module("./lib.mjs", () => ({ a: "preload", n: -9 }));
