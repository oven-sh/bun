import { test, vi } from "bun:test";
const named = load => load.then(found => found.name, error => error.name);
test("t", async () => {
  const gate = Promise.withResolvers();
  let called = "";
  vi.doMock("./kettle.mjs", async () => {
    called += "earlier ";
    await gate.promise;
    return { name: "earlier kettle" };
  });
  const first = named(import("./kettle.mjs"));
  for (let turn = 0; turn < 20; turn++) await null;
  vi.doMock("./kettle.mjs", async () => {
    called += "later";
    await null;
    await null;
    return { name: "later kettle" };
  });
  vi.doMock("./tray.mjs", async () => ({ name: "tray with " + (await named(import("./kettle.mjs"))) }));
  const tray = named(import("./tray.mjs"));
  const second = named(import("./kettle.mjs"));
  console.log("SAID", await tray);
  gate.resolve();
  console.log("SAID", await second, "|", await first, "|", called);
});
