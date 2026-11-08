import { test, vi } from "bun:test";
const heard = load => load.then(it => "got " + (it.width ?? it.seen), error => error.message);
const wait = time => new Promise(done => setTimeout(done, time));
test("a", async () => {
  const held = heard(import("./lamp.mjs"));
  const first = heard(import("./wick.mjs"));
  await wait(5);
  vi.doMock("./wick.mjs", () => ({ width: "second" }));
  console.log(await heard(import("./lantern.mjs")), "|", await held, "|", await first);
  await wait(80);
  console.log(globalThis.calls);
});
