import { test, mock } from "bun:test";
import { through } from "./between";
test("a", () => {
  mock.module("./dep", () => ({ value: () => "mock a" }));
  console.log("a", through());
});
