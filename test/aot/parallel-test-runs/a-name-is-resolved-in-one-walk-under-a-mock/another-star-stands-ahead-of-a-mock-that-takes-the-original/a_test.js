import { test, vi } from "bun:test";
test("the name under the mock", async () => {
  vi.doMock("./shapes.mjs", async original => ({ ...(await original()), round: 10 }));
  let said;
  try {
    said = (await import("./user.mjs")).look();
  } catch (error) {
    said = error.name;
  }
  console.log("SAID", said);
});
