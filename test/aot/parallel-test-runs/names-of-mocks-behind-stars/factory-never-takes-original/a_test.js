import { test, vi } from "bun:test";
test("the original shows nothing", async () => {
  vi.doMock("./other.mjs", () => ({ flat: 9, round: 8 }));
  vi.doMock("./shapes.mjs", async original => ({ square: 3 }));
  let said;
  try { said = (await import("./user.mjs")).look(); } catch (error) { said = error.constructor.name + " " + String(error.message).split("\n")[0]; }
  console.log("SAID", said);
});
