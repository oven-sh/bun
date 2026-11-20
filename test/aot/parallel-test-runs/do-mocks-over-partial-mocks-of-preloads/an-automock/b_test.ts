import { test } from "bun:test";
import { get } from "./app";
test("the next file finds the mock of the set-up", () => {
  console.log("SAID next", get());
});
