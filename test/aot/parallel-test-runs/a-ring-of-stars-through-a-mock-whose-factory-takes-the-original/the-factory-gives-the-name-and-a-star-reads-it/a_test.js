import { test, vi } from "bun:test";
test("a ring", async () => {
  vi.doMock("./shapes.mjs", async original => ({ ...(await original()), round: 10 }));
  let said;
  try { said = (await import("./user.mjs")).look(); } catch (error) { said = error.constructor.name + " " + String(error.message).split("\n")[0]; }
  console.log("SAID", said);
});
