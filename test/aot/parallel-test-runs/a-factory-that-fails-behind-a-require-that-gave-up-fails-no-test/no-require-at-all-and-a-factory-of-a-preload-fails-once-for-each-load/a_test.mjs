import { test, vi } from "bun:test";
const heard = load => load.then(it => "got " + (it.width ?? it.seen), error => error.message);
const turn = () => new Promise(done => setTimeout(done, 20));
test("a", async () => {
  globalThis.holdsFactories = true;
  const held = heard(import("./lamp.mjs"));
  const first = heard(import("./wick.mjs"));
  await globalThis.firstCall;
  await turn();
  vi.doMock("./wick.mjs", () => ({ width: "second" }));
  const lantern = await heard(import("./lantern.mjs"));
  globalThis.holdsFactories = false;
  for (const open of globalThis.gates.splice(0)) open();
  console.log(lantern, "|", await held, "|", await first);
  await turn();
  await turn();
  console.log(globalThis.calls);
});
