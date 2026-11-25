import { test, mock } from "bun:test";
import { read } from "./reader";
test("a", () => {
  mock.module("./dep", () => ({ value: () => "mock a" }));
  console.log("a", read());
});
