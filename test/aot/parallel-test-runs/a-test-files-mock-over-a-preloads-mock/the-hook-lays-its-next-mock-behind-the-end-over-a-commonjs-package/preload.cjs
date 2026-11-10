const { mock, beforeEach } = require("bun:test");
mock.module("made-up-pack/lib.cjs", () => ({ who: "preload" }));
let turns = 0;
beforeEach(() => {
  mock.module("made-up-pack/lib.cjs", () => ({ who: "hook " + ++turns }));
});
