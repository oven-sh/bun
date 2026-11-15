const { test, mock, vi } = require("bun:test");
globalThis.files = (globalThis.files ?? 0) + 1;
const run = globalThis.files;
vi.doMock("./lib.mjs", () => ({ word: "test", default: { word: "test" } }));
test("t", async () => {
  const said = [require("./lib.mjs").word];
  
  said.push(require("./lib.mjs").word);
  
  said.push(require("./lib.mjs").word);
  console.log("SAID", run, said.join(), globalThis.bodies, globalThis.libs);
});
