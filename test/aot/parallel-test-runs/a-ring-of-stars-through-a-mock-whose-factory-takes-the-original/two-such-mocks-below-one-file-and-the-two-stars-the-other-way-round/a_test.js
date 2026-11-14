import { test, vi } from "bun:test";
test("a ring", async () => {
  vi.doMock("./shapes.mjs", async original => ({ square: 3 }));
  vi.doMock("./tints.mjs", async original => ({ hue: 5 }));
  let said;
  try { said = (await import("./user.mjs")).look(); } catch (error) { said = error.constructor.name + " " + String(error.message).split("\n")[0]; }
  console.log("SAID", said);
});
