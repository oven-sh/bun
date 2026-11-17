import { test, vi, mock } from "bun:test";
test("x0", async () => {
  vi.doMock("./m.mjs", () => ({ word: "mock 1" }));
  const one = await import("./m.mjs");
  vi.doMock("./o.mjs", () => { mock.module("./m.mjs", () => ({ word: "patch" })); return { o: 1 }; });
  const third = import("./m.mjs");
  const joiner = import("./o.mjs");
  const word = (await third).word;
  console.log("SAID x0 " + word + " " + (await joiner).o + " " + one.word);
});
