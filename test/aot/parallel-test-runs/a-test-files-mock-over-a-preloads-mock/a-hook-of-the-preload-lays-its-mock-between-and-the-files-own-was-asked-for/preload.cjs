const { mock, beforeEach } = require("bun:test");
mock.module("made-up-pack/lib.cjs", () => ({ who: "preload" }));
beforeEach(() => {
  mock.module("made-up-pack/lib.cjs", () => ({ who: "hook" }));
});
