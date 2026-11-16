import { test, vi } from "bun:test";
test("the error", async () => {
  const errors = [];
  const load = async () => { try { await import("./root.mjs"); } catch (error) { errors.push(error); } };
  await import("./far.mjs");
  await load();
  vi.doMock("./far.mjs", () => ({ far: 10 }));
  await load();
  console.log("SAID", errors.length, errors.map(error => error === errors[0]).join());
});
