import { mock, test } from "bun:test";
mock.module("./mocked.mjs", () => ({ own: -3, late: -2, near: -4 }));
test("the names", async () => {
  const { seen } = await import("./user.mjs");
  console.log("SAID", seen);
});
