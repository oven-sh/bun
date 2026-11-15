import { test } from "bun:test";
import lib = require("./lib");
test("what a namespace exports for its file", () => {
  console.log(String(lib.answer));
});
