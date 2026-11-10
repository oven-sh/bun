import { test, vi } from "bun:test";
const key = require.resolve("./lib.mjs");
test("made up", async () => {
  vi.doMock("./dep.mjs", () => ({ d: "mocked d" }));
  require("./lib.mjs");
  vi.doMock("./lib.mjs", async () => { await 0; return { a: "mocked", n: -1 }; });
  vi.doUnmock("./dep.mjs");
  await import("./lib.mjs").catch(() => {});
  require.cache[key] = { exports: { a: "fake" } };
  delete require.cache[key];
  const actual = await vi.importActual("./lib.mjs");
  let word;
  try {
    word = actual.seen();
  } catch (error) {
    word = error.name;
  }
  console.log("SAID", actual.a, actual.n, word);
}, 9000);
