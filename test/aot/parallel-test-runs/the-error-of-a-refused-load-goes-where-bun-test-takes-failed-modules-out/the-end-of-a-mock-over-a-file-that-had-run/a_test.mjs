import { test, vi } from "bun:test";
import { far } from "./far.mjs";
test("the end", async () => {
  const errors = [];
  const load = async () => { try { await import("./ledger.mjs"); errors.push("loaded"); } catch (error) { errors.push(error); } };
  await load();
  vi.doMock("./far.mjs", () => ({ far: 10 }));
  await load();
  vi.doUnmock("./far.mjs");
  await load();
  vi.doMock("./far.mjs", () => ({ far: 20 }));
  await load();
  vi.doUnmock("./far.mjs");
  await load();
  console.log("SAID", far, errors.map((error, index) => (index ? (error === errors[index - 1] ? "kept" : "anew") : error.name)).join());
});
