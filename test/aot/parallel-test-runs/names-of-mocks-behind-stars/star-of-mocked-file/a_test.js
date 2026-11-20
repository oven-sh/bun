import { test, vi } from "bun:test";
test("names", async () => {
  vi.doMock("./other.mjs", () => ({ flat: 9, round: 8 }));
  vi.doMock("./shapes.mjs", async original => ({ ...(await original()), round: 9 }));
  let said;
  try { said = (await import("./user.mjs")).look(); } catch (error) { said = error.constructor.name + " " + String(error.message).split("\n")[0]; }
  console.log("SAID", said);
});
