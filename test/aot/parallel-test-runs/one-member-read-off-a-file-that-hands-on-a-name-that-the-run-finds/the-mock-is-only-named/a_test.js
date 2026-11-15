import { expect, test, vi } from "bun:test";
test("one member is read", async () => {
  if (JSON.parse("false")) vi.doMock("./shapes.mjs", () => ({ square: 3 }));
  const { look } = await import("./user.mjs");
  console.log("SAID", look());
  expect(look()).toBe("5");
});
