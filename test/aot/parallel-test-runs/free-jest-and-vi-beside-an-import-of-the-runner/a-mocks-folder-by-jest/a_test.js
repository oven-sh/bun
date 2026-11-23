import { test } from "bun:test";
import { used } from "./user.js";
jest.mock("./lib.js");
test("the file of __mocks__ stands in", () => {
  console.log(used());
});
