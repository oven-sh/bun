import { jest, test } from "bun:test";
test("a", () => {
  console.log("a", jest.requireActual("tax").rate);
});
