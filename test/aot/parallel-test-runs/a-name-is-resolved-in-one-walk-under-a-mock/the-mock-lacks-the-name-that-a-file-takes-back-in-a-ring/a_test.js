import { test, vi } from "bun:test";
test("the name under the mock", async () => {
  vi.doMock("./shapes.mjs", () => ({ square: 20 }));
  let said;
  try {
    said = (await import("./user.mjs")).look();
  } catch (error) {
    said = error.name;
  }
  console.log("SAID", said);
});
