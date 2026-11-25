import { test } from "bun:test";
import { names } from "./reader.mjs";
test("a", () => {
  console.log("SAID a", names());
});
