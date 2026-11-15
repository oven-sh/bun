import { test, vi } from "bun:test";
let next = 0;
const settle = async () => {
  for (let count = 0; count < 4; count++) await import(`./pebble${next++}.mjs`);
  for (let turn = 0; turn < 6; turn++) await new Promise(done => setImmediate(done));
};
test("an original loaded while another factory of the same file is pending links the real module", async () => {
  const ran = (globalThis.ran = []);
  let open;
  const gate = new Promise(done => (open = done));
  vi.doMock("./kettle.mjs", async () => { ran.push("early factory"); await gate; return { name: "early" }; });
  const held = import("./kettle.mjs");
  await settle();
  vi.doMock("./tray.mjs", async original => ({ ...(await original()), more: 1 }));
  const last = import("./tray.mjs");
  await settle();
  vi.doMock("./kettle.mjs", () => { ran.push("later factory"); return { name: "later" }; });
  open();
  console.log("held:", (await held).name);
  console.log("tray:", (await last).name);
  console.log("kettle again:", (await import("./kettle.mjs")).name);
  console.log("tray again:", (await import("./tray.mjs")).name);
  console.log("ran:", ran.join());
});
