import { test, vi } from "bun:test";
let next = 0;
const settle = async () => {
  for (let count = 0; count < 4; count++) await import(`./pebble${next++}.mjs`);
  for (let tick = 0; tick < 6; tick++) await new Promise(resolve => setImmediate(resolve));
};
const describe = it => { try { return it.name + ", " + it.pour(2) + ", " + (it.pour.mock ? "a mock" : "no mock"); } catch (error) { return "showing it threw " + error.name; } };
test("the pending import gets the later mock", async () => {
  globalThis.ran = [];
  let open;
  globalThis.gate = new Promise(resolve => (open = resolve));
  const timeout = new Promise(resolve => setTimeout(resolve, 700, "never settles"));
  const within = call => Promise.race([call.then(describe, error => "threw " + error.name), timeout]);
  vi.doMock("./kettle.mjs", async () => { (globalThis.ran ??= []).push("early"); await globalThis.gate; return { name: "early", pour: x => "early " + x }; });
  const pending = within(import("./kettle.mjs"));
  await settle();
  vi.doMock("./kettle.mjs", () => { (globalThis.ran ??= []).push("later"); return { name: "later", pour: x => "later " + x }; });
  vi.doMock("./tray.mjs", async original => ({ ...(await original()), more: 1 }));
  const last = within(import("./tray.mjs"));
  await settle();
  open();
  console.log("pending import:", await pending);
  console.log("tray:", await last);
  console.log("kettle again:", await within(import("./kettle.mjs")));
  console.log("tray again:", await within(import("./tray.mjs")));
  console.log("evaluated:", globalThis.ran.join());
});
