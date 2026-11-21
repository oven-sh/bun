const { test, mock, vi } = require("bun:test");
globalThis.files = (globalThis.files ?? 0) + 1;
const run = globalThis.files;

test("t", async () => {
  const said = [require("./gauge.cjs").word];
  vi.doMock("./gauge.cjs", () => ({ word: "test", default: { word: "test" } }));
  said.push(require("./gauge.cjs").word);
  
  said.push(require("./gauge.cjs").word);
  console.log("SAID", run, said.join(), globalThis.bodies, globalThis.libs);
});
