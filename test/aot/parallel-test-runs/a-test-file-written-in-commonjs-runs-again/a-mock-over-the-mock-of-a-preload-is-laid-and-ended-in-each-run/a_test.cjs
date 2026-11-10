const { test, vi } = require("bun:test");
globalThis.files = (globalThis.files ?? 0) + 1;
const run = globalThis.files;
const word = () => require("./gauge.cjs").word;
test("t", () => {
  const said = [word()];
  vi.doMock("./gauge.cjs", () => ({ word: "test" + run }));
  said.push(word());
  vi.doUnmock("./gauge.cjs");
  said.push(word());
  console.log("SAID", run, said.join(), globalThis.bodies);
});
