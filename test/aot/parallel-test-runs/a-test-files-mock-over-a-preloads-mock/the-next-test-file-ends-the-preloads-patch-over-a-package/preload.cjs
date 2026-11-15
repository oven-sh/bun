const { mock } = require("bun:test");
globalThis.first = require("made-up-lib");
mock.module("made-up-lib", () => ({ a: "preload", n: -9 }));
