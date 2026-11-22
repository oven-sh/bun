import { beforeEach, mock } from "bun:test";
mock.module("made-up-pack", () => ({ who: "preload" }));
let turns = 0;
beforeEach(() => {
  mock.module("made-up-pack", () => ({ who: "hook " + ++turns }));
});
