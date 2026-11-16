import { test, mock } from "bun:test";
import { value } from "./dep";
test("b", () => {
  console.log("b before", value());
  require("./helper");
  console.log("b after", value());
  mock.module("./dep", () => ({ value: () => "of the test" }));
  require("./helper");
  console.log("b again", value());
});
