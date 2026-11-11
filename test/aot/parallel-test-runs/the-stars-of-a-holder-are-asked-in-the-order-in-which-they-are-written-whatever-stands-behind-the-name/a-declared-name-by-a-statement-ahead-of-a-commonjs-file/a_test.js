import { test, vi } from "bun:test";
test("one name imported", async () => {
  vi.doMock("./shapes.mjs", () => ({ round: "mocked" }));
  let said;
  try {
    said = String((await import("./user.mjs")).look());
  } catch (error) {
    said = error.name + " " + String(error.message).slice(0, 40);
  }
  console.log("SAID", said);
});
