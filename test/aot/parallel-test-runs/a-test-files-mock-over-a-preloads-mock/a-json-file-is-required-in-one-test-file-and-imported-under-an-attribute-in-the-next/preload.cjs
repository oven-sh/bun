const { mock } = require("bun:test");
mock.module("./lib.json", () => ({ a: "preload", n: -9 }));
