import { test, vi } from "bun:test";
test("the copy that the first mock left is handed out again", async () => {
  vi.doMock("./tally.mjs", () => ({ word: "first" }));
  const early = await vi.importActual("./tally.mjs");
  early.add();
  vi.doUnmock("./tally.mjs");
  vi.doMock("./tally.mjs", () => ({ word: "second" }));
  const again = await vi.importActual("./tally.mjs");
  console.log("SAID", again.sum(), again.add === early.add);
});
