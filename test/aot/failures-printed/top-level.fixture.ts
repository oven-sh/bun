import { expect, test } from "bun:test";

test("is never run", () => {
  expect(1).toBe(1);
});

function setUp(): never {
  throw new Error("thrown while the file loads");
}
setUp();
