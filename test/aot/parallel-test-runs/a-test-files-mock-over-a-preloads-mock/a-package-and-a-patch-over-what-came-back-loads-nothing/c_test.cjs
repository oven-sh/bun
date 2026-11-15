const { test, vi, mock } = require("bun:test");
const NAME = "pack/lib.cjs";
let before = globalThis.runsOfLib ?? 0;
function say(at) {
  const it = require(NAME);
  const now = globalThis.runsOfLib ?? 0;
  console.log("SAID c", at, "runs", now, "more", now - before, it.a, it.n);
  before = now;
}
const D = () => vi.doMock(NAME, () => ({ a: "D c", n: -1 }));
const M = () => mock.module(NAME, () => ({ a: "M c", n: -2 }));
const end = () => vi.doUnmock(NAME);
test("c", () => {
  say("last");
});
