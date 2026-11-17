import { test, vi } from "bun:test";
const turns = async () => {
  for (let turn = 0; turn < 6; turn++) await new Promise(done => setImmediate(done));
};
const shown = got => [got.name, String(got.twice(2)), got.twice.mock ? "a mock" : "no mock", String(got.more)].join(" ");
test("a reset that finds the mock again takes from it what it held of its original", async () => {
  let open;
  globalThis.gate = new Promise(done => (open = done));
  const begun = new Promise(done => (globalThis.hasBegun = done));
  vi.doMock("./part.mjs", async original => {
    console.log("SAID the factory is called");
    return { ...(await original()), more: "of the mock" };
  });
  const call = import("./part.mjs");
  await begun;
  await turns();
  console.log("SAID the modules are reset");
  vi.resetModules();
  open();
  console.log("SAID", shown(await call));
  console.log("SAID imported between:", shown(await import("./part.mjs")));
  console.log("SAID the modules are reset");
  vi.resetModules();
  console.log("SAID asked for again:", shown(await vi.importActual("./part.mjs")));
  console.log("SAID bodies:", globalThis.bodies);
});
