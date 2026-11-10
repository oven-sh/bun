import { test, vi, mock } from "bun:test";
test("x4", async () => {
  vi.doMock("./m.mjs", () => ({ word: "mock 1" }));
  const user = await import("./user.mjs");
  const third = import("./m.mjs");
  vi.doUnmock("./m.mjs");
  const joiner = import("./m.mjs");
  let word;
  try { word = (await third).word; } catch (error) { word = error.name; }
  console.log("SAID x4 " + word + " " + (await joiner).word + " " + user.seen());
});
