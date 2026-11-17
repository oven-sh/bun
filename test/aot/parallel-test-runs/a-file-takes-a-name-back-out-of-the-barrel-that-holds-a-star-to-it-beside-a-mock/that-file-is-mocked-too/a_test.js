import { test, vi } from "bun:test";
test("the namespaces and the names under the mock", async () => {
  vi.doMock("./shapes.mjs", () => ({ round: 10 }));
  vi.doMock("./last.mjs", () => ({ round: 20 }));
  let said;
  try {
    said = (await import("./user.mjs")).look();
  } catch (error) {
    said = error.name;
  }
  console.log("SAID", said);
});
