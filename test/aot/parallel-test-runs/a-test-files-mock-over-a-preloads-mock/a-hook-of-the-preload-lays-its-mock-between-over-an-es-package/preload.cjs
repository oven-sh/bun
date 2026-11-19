const { mock, beforeEach } = require("bun:test");
mock.module("made-up-pack/lib.mjs", () => ({ who: "preload" }));
beforeEach(() => {
  mock.module("made-up-pack/lib.mjs", () => ({ who: "hook" }));
});
