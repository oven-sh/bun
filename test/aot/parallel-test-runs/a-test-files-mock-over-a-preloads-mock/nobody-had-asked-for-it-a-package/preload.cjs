const { mock } = require("bun:test");
mock.module("made-up-lib", () => ({ a: "preload", n: -9 }));
