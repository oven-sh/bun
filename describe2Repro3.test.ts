import { test, beforeAll, expect, beforeEach, afterEach, afterAll, describe } from "bun:test";

beforeAll(async () => {
  Bun.sleep(1).then(() => {
    throw new Error("## stage beforeAll ##");
  });
  await Bun.sleep(1);
});

test("my-test", () => {
  expect(1).toBe(1);
});
