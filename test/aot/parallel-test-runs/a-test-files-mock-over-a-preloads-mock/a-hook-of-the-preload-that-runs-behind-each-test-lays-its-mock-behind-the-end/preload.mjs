import { afterEach, mock } from "bun:test";
mock.module("made-up-pack", () => ({ who: "preload" }));
let turns = 0;
afterEach(() => {
  mock.module("made-up-pack", () => ({ who: "hook " + ++turns }));
});
