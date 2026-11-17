import { test, vi } from "bun:test";
test("the error", async () => {
  const errors = [], said = [];
  const load = async () => { try { said.push("loaded " + (await import("./root.mjs")).ledger); } catch (error) { errors.push(error); said.push(error.name); } };
  await import("./other.mjs").catch(error => said.push(error.name));
  await load();
  vi.doMock("./far.mjs", () => ({ far: 10 }));
  await load();
  console.log("SAID", said.join(), errors.map(error => error === errors[0]).join());
});
