import { test, mock } from "bun:test";
import { through } from "./holder";
test("a", () => {
  mock.module("./dep", () => ({ value: () => "mock a" }));
  console.log("a", through());
});
