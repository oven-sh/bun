import { test, vi } from "bun:test";
test("the original shows nothing", async () => {
  vi.doMock("./shapes.mjs", async original => ({ ...(await original()) }));
  let said;
  try { said = (await import("./user.mjs")).look(); } catch (error) { said = error.constructor.name + " " + String(error.message).split("\n")[0]; }
  console.log("SAID", said);
});
