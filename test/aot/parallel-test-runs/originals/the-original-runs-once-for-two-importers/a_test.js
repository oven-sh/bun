import { test, vi } from "bun:test";
import { count as countOfTest, step as stepOfTest } from "./dep.js";
import { step } from "first";
import { seen } from "second";
vi.mock("./dep.js", () => ({ count: "mocked", step: () => "mocked step" }));
test("both packages have one instance of the file", () => {
  console.log("second sees", seen());
  console.log("first steps to", step(), step());
  console.log("second sees", seen());
  console.log("test file", countOfTest, stepOfTest());
});
