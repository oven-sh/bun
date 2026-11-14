import { test, vi } from "bun:test";
const turns = async () => {
  for (let turn = 0; turn < 6; turn++) await new Promise(done => setImmediate(done));
};
const shown = got => [got.name, String(got.twice(2)), got.twice.mock ? "a mock" : "no mock", String(got.more)].join(" ");
test("the original that was loaded for the mock is what the mock is made of", async () => {
  let open;
  globalThis.gate = new Promise(done => (open = done));
  const begun = new Promise(done => (globalThis.hasBegun = done));
  vi.doMock("./part.mjs");
  const call = import("./part.mjs");
  await begun;
  await turns();
  console.log("SAID the modules are reset");
  vi.resetModules();
  open();
  console.log("SAID", shown(await call));
  console.log("SAID bodies:", globalThis.bodies);
});
