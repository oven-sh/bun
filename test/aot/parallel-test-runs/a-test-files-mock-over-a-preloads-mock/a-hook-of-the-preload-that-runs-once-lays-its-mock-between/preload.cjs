const { mock, beforeAll } = require("bun:test");
mock.module("made-up-pack/lib.cjs", () => ({ who: "preload" }));
beforeAll(() => {
  mock.module("made-up-pack/lib.cjs", () => ({ who: "hook" }));
});
