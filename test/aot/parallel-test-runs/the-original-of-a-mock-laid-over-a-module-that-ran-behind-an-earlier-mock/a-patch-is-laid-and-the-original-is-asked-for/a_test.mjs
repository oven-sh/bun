import { mock, test, vi } from "bun:test";
test("the original of the patch is the module that it patched", async () => {
  vi.doMock("./tally.mjs", () => ({ word: "first" }));
  const early = await vi.importActual("./tally.mjs");
  early.add();
  await import("./tally.mjs");
  vi.doUnmock("./tally.mjs");
  const own = await import("./tally.mjs");
  own.add();
  own.add();
  mock.module("./tally.mjs", () => ({ word: "patched" }));
  const actual = await vi.importActual("./tally.mjs");
  console.log("SAID", actual.sum(), actual.add === early.add, actual.word);
});
