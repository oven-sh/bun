import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./shapes.mjs", async original => { const { round, ...rest } = await original(); return rest; });
  let said;
  try { said = (await import("./user.mjs")).say(); } catch (error) { said = error.name; }
  console.log("SAID", said);
});
