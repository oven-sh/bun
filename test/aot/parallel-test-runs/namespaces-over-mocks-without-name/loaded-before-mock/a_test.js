import { test, vi } from "bun:test";
test("names", async () => {
  await import("./shapes.mjs");
  vi.doMock("./shapes.mjs", () => ({ square: 3 }));
  let said;
  try { said = (await import("./user.mjs")).look(); } catch (error) { said = error.constructor.name + " " + String(error.message).split("\n")[0]; }
  console.log("SAID", said);
});
