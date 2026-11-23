import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./shapes.mjs", async original => ({ ...(await original()), more: 10 }));
  let said;
  try { said = (await import("./user.mjs")).look(); } catch (error) { said = error.constructor.name + " " + String(error.message).slice(0, 60); }
  console.log("SAID", said);
});
