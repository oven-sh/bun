import { expect, test, vi } from "bun:test";
test("one member is read", async () => {
  vi.doMock("./shapes.mjs", () => ({ square: 3, round: 7 }));
  const { look } = await import("./user.mjs");
  console.log("SAID", look());
  expect(look()).toBe("7");
});
