import { test, describe } from "bun:test";

describe("ABC", () => {
  console.log("describe(ABC) called");
  test("DEF", () => {
    console.log("DEF");
  });
});
describe("GHI", () => {
  console.log("describe(GHI) called");
  test("JKL", () => {
    console.log("JKL");
  });
});
