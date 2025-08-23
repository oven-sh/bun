import { afterAll, describe, expect, test, afterEach } from "bun:test";

test("abc", () => {
  throw new Error("faliure");
});
test.concurrent.only.failing.if(true)("abc", () => {});
test.concurrent.only.failing("abc2", () => {
  throw new Error("faliure");
});

test.failing("should pass", () => {
  throw new Error("faliure");
});
