import { test, vi } from "bun:test";
test("the second file", async () => {
  const errors = [];
  const load = async () => { try { await import("./ledger.mjs"); } catch (error) { errors.push(error); } };
  await load();
  vi.doMock("./far.mjs", () => ({ far: 10 }));
  await load();
  console.log("SAID second", errors.map(error => (error === globalThis.first) + " " + (error === errors[0])).join());
  vi.doUnmock("./far.mjs");
});
