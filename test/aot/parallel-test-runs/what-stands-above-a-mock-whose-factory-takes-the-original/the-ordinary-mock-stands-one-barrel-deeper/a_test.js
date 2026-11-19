import { test, vi } from "bun:test";
test("t", async () => {
  vi.doMock("./other.mjs", () => ({ other: "mock" }));
  vi.doMock("./shapes.mjs", async original => ({ ...(await original()), round: 10 }));
  let said;
  try { said = (await import("./user.mjs")).look(); } catch (error) { said = error.constructor.name; }
  console.log("SAID", said);
});
