import { test } from "bun:test";
import { next } from "./mocks_test.cjs";

test("x", () => {
  console.log("x", next());
});
