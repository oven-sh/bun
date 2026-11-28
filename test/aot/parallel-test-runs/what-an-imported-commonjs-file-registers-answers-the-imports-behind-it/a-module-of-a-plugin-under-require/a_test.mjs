import { test, vi } from "bun:test";
const tried = async load => {
  try {
    await load();
    console.log("loaded");
  } catch (error) {
    console.log("failed", error.code ?? error.message);
  }
};
test("a", async () => {
  await tried(() => require("./root.mjs"));
  await tried(() => import("./mid.mjs"));
  vi.resetModules();
  await tried(() => require("./root.mjs"));
});
