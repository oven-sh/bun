import { test, vi } from "bun:test";
test("the original of the second mock is what was loaded behind the first", async () => {
  vi.doMock("./tally.mjs", () => ({ word: "first" }));
  await import("./tally.mjs");
  const early = await vi.importActual("./tally.mjs");
  early.add();
  vi.doUnmock("./tally.mjs");
  const own = await vi.importActual("./tally.mjs");
  own.add();
  own.add();
  vi.doMock("./tally.mjs", () => ({ word: "second" }));
  const again = await vi.importActual("./tally.mjs");
  console.log("SAID", own.sum(), again.sum(), own.add === again.add, early.sum());
});
