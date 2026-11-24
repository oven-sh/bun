import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("node:path", () => ({ sep: "x" }));
  vi.doMock("./utils.mjs", async original => ({ ...(await original()), only: 30 }));
  let said;
  try { said = (await import("./user.mjs")).look(); } catch (error) { said = error.constructor.name; }
  console.log("SAID", said);
});
