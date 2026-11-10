import { mock, test, vi } from "bun:test";
// The mock below another importer is laid three times in a row, so two ends wait when the refused load is asked for and the last mock is laid.
test("the error", async () => {
  const errors = [];
  const load = async () => { try { await import("./ledger.mjs"); } catch (error) { errors.push(error); } };
  vi.doMock("./pan.mjs", () => ({ pan: "mock" }));
  const { stand } = await import("./stand.mjs");
  vi.doMock("./pan.mjs", () => ({ pan: "mock" }));
  vi.doMock("./pan.mjs", () => ({ pan: "mock" }));
  await import("./weigher.cjs");
  await import("./scale.json", { with: { type: "text" } });
  await load();
  await mock.module("./scale.json", () => ({ default: { weight: 2 } }));
  await load();
  console.log("SAID", errors.map(error => error.name + " " + (error === errors[0])).join());
  console.log("SAID stand", stand());
});
