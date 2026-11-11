import { test, vi } from "bun:test";

// The first reset comes while the original is being loaded: what the mock then holds of it stands under no key, and a reset leaves it.
// An import of a file above registers the key of the mock anew, by its statements: the second reset finds it, and the original is loaded anew.
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
  console.log("the file outside came:", (await import("./outer.mjs")).outer);
  vi.resetModules();
  console.log("the original:", (await vi.importActual("./part.mjs")).width);
  console.log("bodies:", globalThis.bodies);
});
