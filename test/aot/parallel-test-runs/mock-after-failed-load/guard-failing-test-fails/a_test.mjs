import { expect, jest, test, vi } from "bun:test";
import { use } from "./user.mjs";
test("a wrong test", () => {
  jest.doMock("./util.mjs");
  console.log("SAID", use());
  expect(use()).toBe("3 real");
});
