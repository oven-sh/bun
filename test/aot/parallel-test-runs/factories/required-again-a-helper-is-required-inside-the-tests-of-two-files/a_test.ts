// bun test lets go of a file that mocked when its test file ends: the next require() runs its body again. Compiled, the body has run: the calls that it made are made again.
import { test } from "bun:test";
import { value } from "./dep";
test("a", () => {
  require("./helper");
  console.log("a", value());
});
