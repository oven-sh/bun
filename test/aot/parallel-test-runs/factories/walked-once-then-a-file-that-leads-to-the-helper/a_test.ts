import { test } from "bun:test";
import { value } from "./dep";
test("a", () => {
  require("./helper");
  console.log("a", value(), require("./other").other, require("./outer").isReady);
});
