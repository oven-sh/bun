import { test, vi } from "bun:test";
test("turns", async () => {
  vi.doMock("./m.mjs", () => ({ word: "mock 1" }));
  const one = await import("./m.mjs");
  const third = import("./m.mjs");
  const fourth = import("./m.mjs");
  for (let i = 0; i < 0; i++) await null;
  vi.doMock("./m.mjs", () => ({ word: "mock 2" }));
  const joiner = Promise.resolve({ word: "none" });
  let word;
  let same;
  let shared;
  try { const got = await third; same = got === one; word = got.word; shared = got === (await fourth); } catch (error) { word = error.name; }
  console.log("SAID " + word + " " + same + " " + shared + " " + (await joiner.then(it => it.word + " " + (it === one), error => error.name)));
  vi.doUnmock("./m.mjs");
});
