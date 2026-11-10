const { mock } = require("bun:test");
mock.module("./k.js", () => ({ x: "preload" }));
