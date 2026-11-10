const { mock } = require("bun:test");
mock.module("made-up-pack/lib.cjs", () => ({ who: "preload" }));
