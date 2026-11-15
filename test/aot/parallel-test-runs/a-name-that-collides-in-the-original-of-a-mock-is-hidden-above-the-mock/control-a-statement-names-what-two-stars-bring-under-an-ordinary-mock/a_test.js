import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./shapes.mjs", () => ({ round: 10, own: 20 }));
  let said;
  try { said = (await import("./user.mjs")).look(); } catch (error) { said = error.constructor.name; }
  console.log("SAID", said);
});
