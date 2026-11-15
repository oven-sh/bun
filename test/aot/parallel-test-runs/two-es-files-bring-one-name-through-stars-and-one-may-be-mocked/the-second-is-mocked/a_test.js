import { test, vi } from "bun:test";
test("by its name", async () => {
  vi.doMock("./shapes.mjs", () => ({ round: 10 }));
  let said;
  try {
    said = (await import("./user.mjs")).look();
  } catch (error) {
    said = error.name;
  }
  console.log("SAID", said);
});
