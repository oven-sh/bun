import { test } from "bun:test";
import * as helpers from "./helpers.mjs";
import { user } from "./user.mjs";
helpers.install();
test("b", () => {
  console.log("SAID b", user());
});
