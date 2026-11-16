import { test, vi } from "bun:test";
const key = require.resolve("./g.cjs");
test("t", async () => {
  const said = [];
  said.push(require("./g.cjs").word, (await import("./h.mjs")).read());
  vi.doMock("./g.cjs", () => ({ word: "own" }));
  vi.doUnmock("./g.cjs");
  const held = require.cache[key];
  require.cache[key] = undefined;
  said.push((await import("./h.mjs")).read(), (await import("./n.mjs")).read(), require("./g.cjs").word, held && held.exports.word);
  console.log("SAID", said.join(), globalThis.ran);
});
