// A later mock is registered while the factory of the earlier one is pending, after the earlier mock was removed.
import { test, vi } from "bun:test";
let next = 0;
const settle = async factory => {
  for (let count = 0; count < 4; count++) await import(`./pebble${next++}.mjs`);
  for (let tick = 0; tick < 6 || !ran.includes(factory); tick++) await new Promise(resolve => setImmediate(resolve));
};
const describe = it => { try { return it.name + ", " + it.pour(2) + ", " + (it.pour.mock ? "a mock" : "no mock"); } catch (error) { return "showing it threw " + error.name; } };
test("the pending import gets the later mock", async () => {
  globalThis.ran = [];
  let open;
  globalThis.gate = new Promise(resolve => (open = resolve));
  const heard = call => call.then(describe, error => "threw " + error.name);
  vi.doMock("./kettle.mjs", async () => { (globalThis.ran ??= []).push("early"); await globalThis.gate; return { name: "early", pour: x => "early " + x }; });
  const pending = heard(import("./kettle.mjs"));
  await settle("early");
  vi.doUnmock("./kettle.mjs");
  vi.doMock("./kettle.mjs", async () => { (globalThis.ran ??= []).push("later"); await null; await null; return { name: "later", pour: x => "later " + x }; });
  vi.doMock("./tray.mjs", async original => ({ ...(await original()), more: 1 }));
  const last = heard(import("./tray.mjs"));
  await settle("later");
  open();
  console.log("pending import:", await pending);
  console.log("tray:", await last);
  console.log("kettle again:", await heard(import("./kettle.mjs")));
  console.log("tray again:", await heard(import("./tray.mjs")));
  console.log("evaluated:", globalThis.ran.join());
});
