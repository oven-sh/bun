import { test, vi, mock } from "bun:test";
test("x2", async () => {
  vi.doMock("./m.mjs", () => ({ word: "mock 1" }));
  const one = await import("./m.mjs");
  const third = import("./m.mjs");
  vi.doUnmock("./m.mjs");
  const joiner = import("./m.mjs");
  console.log("SAID x2 " + ((await third) === one) + " " + ((await joiner) === one));
});
