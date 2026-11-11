import { test, vi } from "bun:test";
const key = require.resolve("./g.cjs");
test("t", async () => {
  const said = [];
  said.push(require("./g.cjs").word);
  vi.doMock("./g.cjs", () => ({ word: "own" }));
  vi.doUnmock("./g.cjs");
  require.cache[key] = { id: key, exports: { word: "mine" }, loaded: true, children: [] };
  try { said.push((await import("./n.mjs")).read()); } catch (error) { said.push(error.name); }
  said.push(require("./g.cjs").word);
  delete require.cache[key];
  try { said.push((await import("./h.mjs")).read()); } catch (error) { said.push(error.name); }
  said.push(require("./g.cjs").word);
  console.log("SAID", said.join(), globalThis.ran);
});
