import { expect, test, vi } from "bun:test";
test("the name comes through two files", async () => {
  vi.doMock("./shapes.mjs", () => ({ square: 3 }));
  const { look } = await import("./user.mjs");
  console.log("SAID", look());
  expect(look()).toBe("round5");
});
