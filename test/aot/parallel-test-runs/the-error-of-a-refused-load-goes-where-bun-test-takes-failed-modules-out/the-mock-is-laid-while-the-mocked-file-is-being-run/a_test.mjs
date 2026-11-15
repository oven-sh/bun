import { test, vi } from "bun:test";
test("the error", async () => {
  const errors = [];
  const load = async () => { try { await import("./ledger.mjs"); } catch (error) { errors.push(error); } };

  await load();
  globalThis.lay = () => {
    vi.doMock("./far.mjs", () => ({ far: 10 }));
  };
  console.log("SAID far", Object.keys(await import("./far.mjs")).join());
  await load();
  console.log("SAID", errors.map(error => error.name + " " + (error === errors[0])).join());

  vi.doUnmock("./far.mjs");
});
