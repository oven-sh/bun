import { test, vi } from "bun:test";
const tried = async (label, load) => {
  let said;
  try { said = await load(); } catch (error) { said = "threw " + error.message; }
  console.log(label, said, "firings", globalThis.firings ?? 0);
};
const load = async () => { const kiln = import.meta.require("./kiln.mjs"); return kiln.heat + " " + kiln.fuel; };
test("an original that threw under its mock stays failed when the module is mocked again", async () => {
  vi.doMock("./kiln.mjs", async () => ({ ...(await vi.importActual("./kiln.mjs")), heat: "mocked" }));
  await tried("first", load);
  globalThis.isLit = true;
  vi.doMock("./kiln.mjs", async () => ({ ...(await vi.importActual("./kiln.mjs")), heat: "mocked" }));
  await tried("second", load);
  await tried("third", load);
});
