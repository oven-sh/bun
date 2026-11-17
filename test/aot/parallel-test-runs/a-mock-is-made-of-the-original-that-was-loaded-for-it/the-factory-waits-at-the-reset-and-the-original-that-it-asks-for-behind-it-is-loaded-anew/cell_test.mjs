import { test, vi } from "bun:test";
const turns = async () => {
  for (let turn = 0; turn < 6; turn++) await new Promise(done => setImmediate(done));
};
const shown = got => [got.name, String(got.twice(2)), got.twice.mock ? "a mock" : "no mock", String(got.more)].join(" ");
test("the reset takes from the mock what it held of its original", async () => {
  let go, called;
  const sign = new Promise(done => (go = done));
  const begun = new Promise(done => (called = done));
  vi.doMock("./part.mjs", async original => {
    console.log("SAID the factory is called");
    called();
    await sign;
    console.log("SAID the factory asks for the original");
    return { ...(await original()), more: "of the mock" };
  });
  const call = import("./part.mjs");
  await begun;
  await turns();
  console.log("SAID the modules are reset");
  vi.resetModules();
  go();
  console.log("SAID", shown(await call));
  console.log("SAID bodies:", globalThis.bodies);
});
