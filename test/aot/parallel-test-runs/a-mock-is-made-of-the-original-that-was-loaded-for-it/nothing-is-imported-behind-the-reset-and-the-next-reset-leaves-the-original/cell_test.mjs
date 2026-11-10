import { test, vi } from "bun:test";

// The first reset comes while the original is being loaded: what the mock then holds of it stands under no key, and a reset leaves it.
// Nothing registers the key anew: the second reset leaves it too, and it answers.
const begun = new Promise(done => (globalThis.hasBegun = done));
let letBodyEnd;
globalThis.mayEnd = new Promise(done => (letBodyEnd = done));
test("the original is asked for behind two resets", async () => {
  vi.doMock("./part.mjs", async original => ({ ...(await original()), width: "mocked" }));
  const held = import("./part.mjs").then(it => console.log("the call came:", it.width));
  await begun;
  vi.resetModules();
  letBodyEnd();
  await held;
  vi.resetModules();
  console.log("the original:", (await vi.importActual("./part.mjs")).width);
  console.log("bodies:", globalThis.bodies);
});
