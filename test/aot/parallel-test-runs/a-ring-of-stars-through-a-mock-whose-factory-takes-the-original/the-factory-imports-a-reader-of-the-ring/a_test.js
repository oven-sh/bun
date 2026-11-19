import { test, vi } from "bun:test";
test("a ring", async () => {
  vi.doMock("./shapes.mjs", async original => { const real = await original(); const side = await import("./side.mjs"); console.log("SAID side", side.look()); return { ...real, square: 3 }; });
  let said;
  try { said = (await import("./user.mjs")).look(); } catch (error) { said = error.constructor.name + " " + String(error.message).split("\n")[0]; }
  console.log("SAID", said);
});
