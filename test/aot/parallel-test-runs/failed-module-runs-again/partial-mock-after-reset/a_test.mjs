import { test, vi } from "bun:test";
const tried = async (label, load) => {
  let said;
  try { said = await load(); } catch (error) { said = "threw " + error.message; }
  console.log(label, said, "firings", globalThis.firings ?? 0);
};
const load = async () => (await import("./potter.mjs")).look();
test("the module throws", async () => {
  await tried("first", load);
  vi.resetModules();
});
test("a partial mock after a reset gets an original that runs again", async () => {
  globalThis.isLit = true;
  vi.doMock("./kiln.mjs", async original => ({ ...(await original()), heat: "mocked" }));
  await tried("second", load);
  await tried("third", load);
});
