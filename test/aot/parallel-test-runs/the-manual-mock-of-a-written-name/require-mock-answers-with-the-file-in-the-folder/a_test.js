import { jest, test } from "bun:test";
test("jest.requireMock", () => {
  console.log("SAID", jest.requireMock("./src/old.cjs").who(), require("./src/old.cjs").who());
});
