const { test, mock, vi } = require("bun:test");
globalThis.files = (globalThis.files ?? 0) + 1;
const run = globalThis.files;
vi.mock("./lib.mjs", () => ({ word: "test", default: { word: "test" } }));
test("t", async () => {
  const said = [require("./user.mjs").word()];
  
  said.push(require("./user.mjs").word());
  
  said.push(require("./user.mjs").word());
  console.log("SAID", run, said.join(), globalThis.bodies, globalThis.libs);
});
