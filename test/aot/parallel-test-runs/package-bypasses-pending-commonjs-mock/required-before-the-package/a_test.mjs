import { test, vi } from "bun:test";
test("the package keeps the original that a require() has evaluated", async () => {
  vi.doMock("./lib.cjs", async original => ({ ...(await original()), kept: "mock" }));
  console.log("required", import.meta.require("./lib.cjs").kept);
  const { space } = await import("pack");
  console.log("package", space.kept, space.runs);
  console.log("project", (await import("./lib.cjs")).kept);
  console.log("package", space.kept, "runs", globalThis.runs);
});
