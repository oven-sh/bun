// While helper.ts waits to lay its mock again, a require() of a file that does not lead to it walks once and is answered at once from then on. The helper's own require() still lays the mock.
import { test } from "bun:test";
import { value } from "./dep";
test("a", () => {
  require("./helper");
  console.log("a", value(), require("./other").other, require("./outer").isReady);
});
