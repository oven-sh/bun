import { test, vi } from "bun:test";
test("the error", async () => {
  const errors = [];
  const load = async () => { try { await import("./ledger.mjs"); } catch (error) { errors.push(error); } };
  console.log("SAID far", (await import("./far.mjs")).far, typeof (await import("./far.mjs", { with: { type: "text" } })).default);
  await load();
  vi.doMock("./far.mjs", () => ({ far: 10 }));
  await load();
  console.log("SAID", errors.map(error => error.name + " " + (error === errors[0])).join());

  vi.doUnmock("./far.mjs");
});
