import { test, vi } from "bun:test";
test("the error", async () => {
  const errors = [];
  const load = async () => { try { await import("./ledger.mjs"); } catch (error) { errors.push(error); } };
  const pending = import("./far.mjs");
  while (!globalThis.release) await new Promise(turn => setImmediate(turn));
  await load();
  vi.doMock("./far.mjs", () => ({ far: 10 }));
  await load();
  console.log("SAID", errors.map(error => error.name + " " + (error === errors[0])).join());
  globalThis.release();
  console.log("SAID far", Object.keys(await pending).join());
  vi.doUnmock("./far.mjs");
});
