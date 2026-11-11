import { test, vi, mock } from "bun:test";
import { createRequire } from "node:module";
const need = createRequire(import.meta.url);
setTimeout(() => { console.log("SAID still waiting"); process.exit(4); }, 3000).unref();
test("x2", async () => {
  vi.doMock("./m.mjs", () => ({ word: "mock 1" }));
  const one = await import("./m.mjs");
  let inner;
  vi.doMock("./o.mjs", () => { vi.doUnmock("./m.mjs"); inner = import("./m.mjs"); return { o: 1 }; });
  const third = import("./m.mjs");
  ;
  const joiner = import("./o.mjs");
  let word;
  let same;
  try { const got = await third; same = got === one; word = got.word; } catch (error) { word = error.name; }
  console.log("SAID x2 " + word + " " + same + " " + (await joiner).o);
  console.log("SAID inner " + (await Promise.resolve(inner).then(it => (it ? it.word + " " + (it === one) : "none"), error => error.name)));
  vi.doUnmock("./o.mjs");
});
