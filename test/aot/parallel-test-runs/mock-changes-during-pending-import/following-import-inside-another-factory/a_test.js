import { test, vi, mock } from "bun:test";
test("x2", async () => {
  vi.doMock("./m.mjs", () => ({ word: "mock 1" }));
  const one = await import("./m.mjs");
  let inner;
  vi.doMock("./o.mjs", () => { inner = import("./m.mjs"); return { o: 1 }; });
  const third = import("./m.mjs");
  vi.doUnmock("./m.mjs");
  const joiner = import("./o.mjs");
  let word;
  let same;
  try { const got = await third; same = got === one; word = got.word; } catch (error) { word = error.name; }
  console.log("SAID x2 " + word + " " + same + " " + (await joiner).o);
  await inner;
  vi.doUnmock("./o.mjs");
});
