import { test } from "bun:test";
import { tries } from "./prebuilt.js";
test("reads and calls", () => {
  console.log(tries());
});
