import { createRequire } from "node:module";
import { jest, mock, test, vi } from "bun:test";
const ask = async label => console.log("SAID", label, await import("./part.mjs").then(it => it.word, error => error.message), globalThis.runs);
test("a", async () => {
  await ask("first");
  vi.doMock("./part.mjs");
  await ask("mocked");
  vi.doUnmock("./part.mjs");
  await ask("after");
});
