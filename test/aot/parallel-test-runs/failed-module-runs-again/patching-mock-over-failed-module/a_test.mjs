import { test, vi } from "bun:test";
const tried = async (label, load) => {
  let said;
  try { said = await load(); } catch (error) { said = "threw " + error.message; }
  console.log(label, said, "firings", globalThis.firings ?? 0);
};
test("vi.mock under another name calls its factory at once over a module that threw", async () => {
  await tried("first", async () => (await import("./kiln.mjs")).heat);
  let saved;
  const register = vi.mock;
  register("./kiln.mjs", original => {
    saved = original;
    original().catch(() => {});
    return { heat: "mocked" };
  });
  console.log("after the call", typeof saved);
  await tried("the original", async () => Object.keys(await saved()).join());
});
