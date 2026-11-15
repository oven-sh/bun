import { test, vi } from "bun:test";
test("called by its name", async () => {
  vi.doMock("./shapes.mjs", () => ({
    round() {
      return "mock " + typeof this;
    },
  }));
  console.log("SAID", (await import("./user.mjs")).look());
});
