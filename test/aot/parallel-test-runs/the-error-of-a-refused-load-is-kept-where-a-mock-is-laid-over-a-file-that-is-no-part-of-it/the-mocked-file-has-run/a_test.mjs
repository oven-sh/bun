import { test, vi } from "bun:test";
import { far } from "./far.mjs";
test("the error", async () => {
  const errors = [];
  const load = async () => { try { await import("./ledger.mjs"); } catch (error) { errors.push(error); } };
  await load();
  vi.doMock("./far.mjs", () => ({ far: 10 }));
  await load();
  console.log("SAID", errors.map(error => error.name + " " + (error === errors[0])).join());
  console.log("SAID far", far);
});
