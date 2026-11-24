import { test, vi } from "bun:test";
test("names", async () => {
  await import("./shapes.mjs");
  vi.doMock("./shapes.mjs", async original => ({ ...(await original()), round: 9 }));
  let said;
  try { said = (await import("./user.mjs")).look(); } catch (error) { said = error.constructor.name + " " + String(error.message).split("\n")[0]; }
  console.log("SAID", said);
});
