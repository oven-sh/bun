import { test, vi, mock } from "bun:test";
const keys = space => Object.keys(space).sort().join();
const say = (...words) => console.log("SAID", ...words, globalThis.runs ?? 0);
test("one", async () => {
  vi.doUnmock("./gauge.mjs");
  say("the old barrel", keys(await import("./porch.js")));
  mock.module("./gauge.mjs", () => {
    say("the factory runs");
    return { lent: 2 };
  });
  say("laid");
  say("a fresh barrel", keys(await import("./yard.js")));
});
