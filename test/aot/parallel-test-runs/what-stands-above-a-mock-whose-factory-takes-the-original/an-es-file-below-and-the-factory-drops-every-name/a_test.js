import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./mid.js", async original => { await original(); return { other: 1 }; });
  let said;
  try { said = (await import("./user.js")).look(); } catch (error) { said = error.constructor.name; }
  console.log("SAID", said);
});
